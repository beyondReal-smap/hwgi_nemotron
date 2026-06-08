"""POST /api/cannibal — N개 안의 반응 코호트 겹침(잠식) 행렬.

설계:
- 각 안에 대해 [소구점 추출 → 임베딩 → 코호트 인덱스 추출]을 asyncio.gather로 병렬화
- 무거운 후처리(top/mid/bottom 페르소나·지역 집계)는 우회 — 반응자 인덱스 집합만 필요
- 겹침 행렬(N×N)은 services/cannibalization.py에서 집합 연산(LLM 0콜, 수십 ms)
- 인덱스 배열은 서버 메모리에서만 소비, 응답엔 스칼라 행렬만(인덱스 비노출)
- 겹침은 임베딩 의미 유사도 기반 → '실 구매 잠식'이 아님(경고/면책으로 전달)
"""

from __future__ import annotations

import asyncio
import logging
from time import perf_counter

import numpy as np
from fastapi import APIRouter, HTTPException
from openai import UnprocessableEntityError

from models.schemas import (
    CannibalItemMeta,
    CannibalRequest,
    CannibalResponse,
    CoverageStep,
    ExclusiveProfile,
    MultiplicityBin,
    SellingPoints,
)
from services.cannibal_persistence import persist_cannibal
from services.cannibalization import (
    SMALL_COHORT_MIN,
    build_overlap_matrices,
    compute_coverage,
    compute_exclusive,
    compute_multiplicity,
)
from services.llm import embed_text, extract_selling_points
from services.pii_mask import mask_pii
from services.scoring import (
    _aggregate_districts_full,
    _build_demographics,
    build_query_text,
    score_all_personas,
)
from services.store import get_store

logger = logging.getLogger("personafit.cannibal")

router = APIRouter(prefix="/api", tags=["cannibal"])


@router.post("/cannibal", response_model=CannibalResponse)
async def cannibal(req: CannibalRequest) -> CannibalResponse:
    """N개 안의 반응 코호트 겹침 행렬(방향성 + Jaccard)."""
    # PII 마스킹 — 입력 경계에서 1회 처리(LLM·응답 모두에 PII 미잔존)
    for item in req.items:
        item.text = mask_pii(item.text)

    overall_t0 = perf_counter()
    store = get_store()

    async def _score_one(
        label: str, text: str
    ) -> tuple[str, SellingPoints, np.ndarray, np.ndarray, dict[str, int]]:
        """단일 안: 소구점 → 임베딩 → (반응 코호트 인덱스, 전체 점수 배열).

        all_scores는 전용층 지역 집계(_aggregate_districts_full)에 필요해 함께 반환한다.
        """
        timing: dict[str, int] = {}
        t0 = perf_counter()
        sp: SellingPoints = await asyncio.to_thread(
            extract_selling_points, text, req.llm_provider, req.input_mode
        )
        timing["extract"] = int((perf_counter() - t0) * 1000)

        t0 = perf_counter()
        query_vec = np.array(
            await asyncio.to_thread(embed_text, build_query_text(sp)),
            dtype=np.float32,
        )
        timing["embed"] = int((perf_counter() - t0) * 1000)

        t0 = perf_counter()
        all_scores, _pop, cohort_indices = await asyncio.to_thread(
            score_all_personas, sp, query_vec, store
        )
        idx = cohort_indices[req.cohort_level]
        timing["score"] = int((perf_counter() - t0) * 1000)
        return label, sp, idx, all_scores, timing

    # 안별 병렬 분석 (A/B abtest.py와 동일한 에러 분기)
    try:
        results = await asyncio.gather(
            *[_score_one(it.label, it.text) for it in req.items]
        )
    except UnprocessableEntityError as e:
        logger.warning("잠식 분석 입력 거부(PII 등): %s", e)
        raise HTTPException(
            status_code=422,
            detail="입력에 처리할 수 없는 개인정보(주민등록번호·카드번호 등)가 포함되어 있습니다.",
        ) from e
    except Exception as e:
        logger.exception("잠식 분석 스코어링 실패")
        raise HTTPException(status_code=502, detail=f"분석 오류: {e}") from e

    # 겹침 행렬 — 서버 메모리 내부에서 집합 연산, 스칼라 행렬만 산출
    t0 = perf_counter()
    cohorts = [idx for _label, _sp, idx, _scores, _t in results]
    directional, jaccard, sizes = build_overlap_matrices(cohorts)
    matrix_ms = int((perf_counter() - t0) * 1000)

    # 집합대수 확장 — coverage(union greedy)·multiplicity(bincount)·exclusive(setdiff).
    # demographics/지역 N회 재계산이 동기(pandas)라 to_thread로 이벤트 루프 보호.
    def _setops() -> tuple[list, list, list[ExclusiveProfile]]:
        cov = compute_coverage(cohorts)
        mult = compute_multiplicity(cohorts)
        profiles: list[ExclusiveProfile] = []
        for i, (label, _sp, idx, all_scores, _t) in enumerate(results):
            ex = compute_exclusive(cohorts, i)
            ratio = float(ex.size / idx.size) if idx.size else 0.0
            profiles.append(
                ExclusiveProfile(
                    item_index=i,
                    label=label,
                    exclusive_size=int(ex.size),
                    exclusive_ratio=ratio,
                    demographics=_build_demographics(store.df, ex, store),
                    districts=_aggregate_districts_full(store.df, all_scores, ex, store),
                )
            )
        return cov, mult, profiles

    t0 = perf_counter()
    coverage_raw, multiplicity_raw, exclusive_profiles = await asyncio.to_thread(_setops)
    coverage = [
        CoverageStep(
            rank=r + 1, item_index=ix, label=results[ix][0], marginal=m, cumulative=c
        )
        for r, (ix, m, c) in enumerate(coverage_raw)
    ]
    multiplicity = [
        MultiplicityBin(overlap_count=k, persona_count=p) for k, p in multiplicity_raw
    ]
    setops_ms = int((perf_counter() - t0) * 1000)

    # 정직성 경고 — 소표본 코호트(매칭 부족)는 겹침 노이즈가 크다
    warnings: list[str] = []
    if any(s < SMALL_COHORT_MIN for s in sizes):
        warnings.append("small_cohort")

    items_meta = [
        CannibalItemMeta(label=label, cohort_size=sizes[i], summary=sp.summary)
        for i, (label, sp, _idx, _scores, _t) in enumerate(results)
    ]

    elapsed = {
        # 병렬 실행이라 단계별 wall-clock은 가장 느린 안 기준(max)
        "extract": max(t["extract"] for *_rest, t in results),
        "embed": max(t["embed"] for *_rest, t in results),
        "score": max(t["score"] for *_rest, t in results),
        "matrix": matrix_ms,
        "setops": setops_ms,
        "total": int((perf_counter() - overall_t0) * 1000),
    }

    # 이력 영속화 — 입력 텍스트는 제외(요약·결과만). 인덱스는 애초에 응답에 없음.
    cannibal_id = persist_cannibal({
        "input_mode": req.input_mode,
        "cohort_level": req.cohort_level,
        "llm_provider": req.llm_provider,
        "items": [m.model_dump() for m in items_meta],
        "directional_matrix": directional,
        "jaccard_matrix": jaccard,
        "warnings": warnings,
        "elapsed_ms": elapsed,
        "coverage": [c.model_dump() for c in coverage],
        "multiplicity": [m.model_dump() for m in multiplicity],
        "exclusive_profiles": [e.model_dump() for e in exclusive_profiles],
    })

    return CannibalResponse(
        cannibal_id=cannibal_id,
        items=items_meta,
        directional_matrix=directional,
        jaccard_matrix=jaccard,
        cohort_level=req.cohort_level,
        warnings=warnings,
        elapsed_ms=elapsed,
        coverage=coverage,
        multiplicity=multiplicity,
        exclusive_profiles=exclusive_profiles,
    )
