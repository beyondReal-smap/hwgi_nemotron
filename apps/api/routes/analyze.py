"""POST /api/analyze — 상품 텍스트를 받아 페르소나 매칭 결과·리포트 반환."""

from __future__ import annotations

import asyncio
import logging
from time import perf_counter

import numpy as np
from fastapi import APIRouter, HTTPException
from openai import UnprocessableEntityError

from models.schemas import AnalyzeRequest, AnalyzeResponse
from services.llm import embed_text, extract_selling_points, generate_report
from services.opinions import generate_persona_opinions
from services.persistence import persist_analysis
from services.pii_mask import mask_pii
from services.scoring import build_query_text, score_personas
from services.store import get_store

logger = logging.getLogger("personafit.analyze")

router = APIRouter(prefix="/api", tags=["analyze"])


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
    """상품설명서·약관 → 타겟 페르소나 + 반응도 + 페르소나별 의견 + 리포트."""
    # PII 마스킹 — 입력 경계에서 한 번 처리해 LLM·영속 저장(analyses.jsonl)·응답 모두에 PII가 남지 않게 한다.
    req.product_text = mask_pii(req.product_text)
    elapsed: dict[str, int] = {}
    overall_t0 = perf_counter()

    # 1) 소구점 추출 (provider별)
    t0 = perf_counter()
    try:
        sp = await asyncio.to_thread(
            extract_selling_points, req.product_text, req.llm_provider
        )
    except UnprocessableEntityError as e:
        logger.warning("분석 입력 거부(PII 등): %s", e)
        raise HTTPException(
            status_code=422,
            detail="입력에 처리할 수 없는 개인정보(주민등록번호·카드번호 등)가 포함되어 있습니다. 해당 정보를 제거한 뒤 다시 시도해 주세요.",
        ) from e
    except Exception as e:
        logger.exception("selling_points 추출 실패")
        raise HTTPException(status_code=502, detail=f"LLM(소구점) 오류: {e}") from e
    elapsed["selling_points"] = int((perf_counter() - t0) * 1000)

    # 2) OpenAI — 쿼리 임베딩
    t0 = perf_counter()
    try:
        query_vec = np.array(
            await asyncio.to_thread(embed_text, build_query_text(sp)),
            dtype=np.float32,
        )
    except Exception as e:
        logger.exception("임베딩 실패")
        raise HTTPException(status_code=502, detail=f"임베딩 오류: {e}") from e
    elapsed["embed"] = int((perf_counter() - t0) * 1000)

    # 3) 스코어링 (인메모리)
    t0 = perf_counter()
    try:
        store = get_store()
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=500,
            detail=f"페르소나 데이터 미적재: {e}. scripts/sample_personas.py와 embed_personas.py 실행 필요.",
        ) from e

    (
        top_personas,
        mid_personas,
        bottom_personas,
        province_stats,
        district_stats,
        population_stats,
    ) = await asyncio.to_thread(score_personas, sp, query_vec, store)
    elapsed["score"] = int((perf_counter() - t0) * 1000)

    if not top_personas:
        raise HTTPException(status_code=422, detail="매칭된 페르소나가 없습니다. 입력 조건이 너무 좁습니다.")

    # 4) 페르소나 의견 생성 — 상/중/하 각 30명 병렬 (asyncio.gather로 3개 태스크 동시 실행).
    # top_k 슬라이스는 응답 표시용. 의견은 스코어링 결과 전체 30명에 대해 생성한다.
    sliced_top = top_personas[: req.top_k]
    t0 = perf_counter()
    try:
        top_opinions_task = generate_persona_opinions(
            top_personas, sp, provider=req.llm_provider
        )
        mid_opinions_task = generate_persona_opinions(
            mid_personas, sp, provider=req.llm_provider
        )
        bottom_opinions_task = generate_persona_opinions(
            bottom_personas, sp, provider=req.llm_provider
        )
        top_opinions, mid_opinions, bottom_opinions = await asyncio.gather(
            top_opinions_task, mid_opinions_task, bottom_opinions_task
        )
    except Exception as e:
        logger.exception("의견 생성 실패")
        raise HTTPException(status_code=502, detail=f"LLM(의견) 오류: {e}") from e
    elapsed["opinions"] = int((perf_counter() - t0) * 1000)

    # 5) 리포트 생성 (provider별, 100만 행 모집단 기반)
    t0 = perf_counter()
    try:
        report_md = await asyncio.to_thread(
            generate_report, sp, top_personas, population_stats, req.llm_provider
        )
    except Exception as e:
        logger.exception("리포트 생성 실패")
        raise HTTPException(status_code=502, detail=f"LLM(리포트) 오류: {e}") from e
    elapsed["report"] = int((perf_counter() - t0) * 1000)

    elapsed["total"] = int((perf_counter() - overall_t0) * 1000)

    # 6) 응답 객체 + 영속화
    response = AnalyzeResponse(
        analysis_id="pending",
        selling_points=sp,
        top_personas=sliced_top,
        mid_personas=mid_personas,
        bottom_personas=bottom_personas,
        province_stats=province_stats,
        district_stats=district_stats,
        population_stats=population_stats,
        top_opinions=top_opinions,
        mid_opinions=mid_opinions,
        bottom_opinions=bottom_opinions,
        report_md=report_md,
        elapsed_ms=elapsed,
    )

    analysis_id = persist_analysis({
        "product_text": req.product_text[:500],  # 본문 일부만 (로그 비대화 방지)
        "selling_points": sp.model_dump(),
        "top_personas": [p.model_dump() for p in response.top_personas],
        "mid_personas": [p.model_dump() for p in response.mid_personas],
        "bottom_personas": [p.model_dump() for p in response.bottom_personas],
        "province_stats": [r.model_dump() for r in province_stats],
        "district_stats": [r.model_dump() for r in district_stats],
        "population_stats": population_stats.model_dump(),
        "top_opinions": [o.model_dump() for o in top_opinions],
        "mid_opinions": [o.model_dump() for o in mid_opinions],
        "bottom_opinions": [o.model_dump() for o in bottom_opinions],
        "report_md": report_md,
        "elapsed_ms": elapsed,
        "llm_provider": req.llm_provider,
    })
    response.analysis_id = analysis_id

    return response
