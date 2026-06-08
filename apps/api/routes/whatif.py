"""POST /api/whatif — 기 분석 위에서 타겟·가중치만 바꿔 즉시 재점수.

손끝 탐색(What-if): 분석 결과의 고정 스냅샷을 인터랙티브 시뮬레이터로 만든다.
override가 target_keywords/summary를 건드리지 않으므로 build_query_text 결과가 불변 →
embed_text가 2계층 캐시 hit(0ms). 따라서 cosine 84ms + rule/cat 재계산만으로 100만 분포·
cohort·세그먼트가 갱신된다(임베딩 API 0콜, LLM 0콜). 슬라이더 디바운스 호출에 적합.
"""

from __future__ import annotations

import asyncio
import logging
from time import perf_counter

import numpy as np
from fastapi import APIRouter, HTTPException

from models.schemas import SellingPoints, WhatIfRequest, WhatIfResponse
from services.llm import embed_text
from services.persistence import get_analysis
from services.scoring import build_query_text, score_personas
from services.segment_discovery import discover_segments
from services.store import get_store

logger = logging.getLogger("personafit.whatif")

router = APIRouter(prefix="/api", tags=["whatif"])

# override 가능한 필드 — None이면 베이스 selling_points 값 유지(빈 배열은 명시적 해제).
_OVERRIDE_FIELDS = (
    "target_age_min",
    "target_age_max",
    "target_sex",
    "target_family_types",
    "target_education_levels",
    "target_occupations",
    "persona_category_weights",
)


@router.post("/whatif", response_model=WhatIfResponse)
async def whatif(req: WhatIfRequest) -> WhatIfResponse:
    """저장된 분석의 selling_points에 override를 적용해 즉시 재점수."""
    overall_t0 = perf_counter()

    record = get_analysis(req.analysis_id)
    if record is None:
        raise HTTPException(status_code=404, detail="분석을 찾을 수 없습니다. 분석 ID를 확인해 주세요.")
    sp_raw = record.get("selling_points")
    if not sp_raw:
        raise HTTPException(status_code=422, detail="이 분석에는 소구점 정보가 없어 What-if를 적용할 수 없습니다.")

    try:
        base_sp = SellingPoints.model_validate(sp_raw)
    except Exception as e:
        logger.exception("저장된 selling_points 파싱 실패")
        raise HTTPException(status_code=422, detail=f"저장된 분석 데이터가 손상되었습니다: {e}") from e

    # override 병합 — 명시된(None 아님) 필드만 덮어쓴다.
    overrides = {
        f: getattr(req, f) for f in _OVERRIDE_FIELDS if getattr(req, f) is not None
    }
    new_sp = base_sp.model_copy(update=overrides)

    # 쿼리 임베딩 — query_text는 summary/key_benefits/target_keywords 기반이라 target/가중치
    # override와 무관 → embed_text 캐시 hit(0ms)가 일반적. (드물게 miss여도 1콜)
    t0 = perf_counter()
    try:
        query_vec = np.array(
            await asyncio.to_thread(embed_text, build_query_text(new_sp)),
            dtype=np.float32,
        )
    except Exception as e:
        logger.exception("What-if 임베딩 실패")
        raise HTTPException(status_code=502, detail=f"임베딩 오류: {e}") from e
    embed_ms = int((perf_counter() - t0) * 1000)

    try:
        store = get_store()
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=f"페르소나 데이터 미적재: {e}") from e

    t0 = perf_counter()
    (
        top_personas,
        _mid,
        _bottom,
        _province,
        _district,
        population_stats,
        cohort_indices,
        all_scores,
    ) = await asyncio.to_thread(score_personas, new_sp, query_vec, store)
    score_ms = int((perf_counter() - t0) * 1000)

    if not top_personas:
        raise HTTPException(
            status_code=422,
            detail="이 조건에 매칭된 페르소나가 없습니다. 타겟 범위를 넓혀 보세요.",
        )

    t0 = perf_counter()
    segments = await asyncio.to_thread(
        discover_segments, store, cohort_indices["target"], all_scores
    )
    segments_ms = int((perf_counter() - t0) * 1000)

    return WhatIfResponse(
        population_stats=population_stats,
        segments=segments,
        top_personas=top_personas[:20],
        elapsed_ms={
            "embed": embed_ms,
            "score": score_ms,
            "segments": segments_ms,
            "total": int((perf_counter() - overall_t0) * 1000),
        },
    )
