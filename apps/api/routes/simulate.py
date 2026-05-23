"""POST /api/simulate — 분석 결과의 페르소나에게 설문 응답 시뮬레이션."""

from __future__ import annotations

import logging
from time import perf_counter

from fastapi import APIRouter, HTTPException

from models.schemas import (
    PersonaHit,
    SimulateRequest,
    SimulateResponse,
)
from services.persistence import append_simulation, get_analysis
from services.simulation import simulate_survey_responses

logger = logging.getLogger("personafit.simulate")

router = APIRouter(prefix="/api", tags=["simulate"])


@router.post("/simulate", response_model=SimulateResponse)
async def simulate(req: SimulateRequest) -> SimulateResponse:
    """기 분석된 페르소나 상위 N명에게 주관식 문항 응답 시뮬레이션."""
    overall_t0 = perf_counter()
    elapsed: dict[str, int] = {}

    # 1) 분석 이력 조회 (analysis_id 검증 + 페르소나 복원)
    rec = get_analysis(req.analysis_id)
    if rec is None:
        raise HTTPException(
            status_code=404, detail=f"분석 이력 없음: {req.analysis_id}"
        )

    top_personas_raw = rec.get("top_personas") or []
    if not top_personas_raw:
        raise HTTPException(
            status_code=422,
            detail="해당 분석에 매칭된 페르소나가 없습니다.",
        )

    try:
        personas = [PersonaHit.model_validate(p) for p in top_personas_raw]
    except Exception as e:
        logger.exception("페르소나 역직렬화 실패")
        raise HTTPException(
            status_code=500, detail=f"페르소나 데이터 손상: {e}"
        ) from e

    product_summary = (rec.get("selling_points") or {}).get("summary") or "보험·금융 상품"

    # 2) Haiku N콜 병렬
    t0 = perf_counter()
    try:
        responses = await simulate_survey_responses(
            personas=personas,
            product_summary=product_summary,
            question=req.question,
            n=req.n_respondents,
            provider=req.llm_provider,
        )
    except Exception as e:
        logger.exception("시뮬레이션 호출 실패")
        raise HTTPException(status_code=502, detail=f"LLM(시뮬레이션) 오류: {e}") from e
    elapsed["simulate"] = int((perf_counter() - t0) * 1000)

    if not responses:
        raise HTTPException(
            status_code=502,
            detail="모든 페르소나 응답 생성에 실패했습니다. 잠시 후 다시 시도해주세요.",
        )

    # 3) 영속화 (analysis_id로 조인)
    t0 = perf_counter()
    simulation_id = append_simulation({
        "analysis_id": req.analysis_id,
        "question": req.question,
        "n_respondents": req.n_respondents,
        "responses": [r.model_dump() for r in responses],
        "elapsed_ms": {"simulate": elapsed["simulate"]},
        "llm_provider": req.llm_provider,
    })
    elapsed["persist"] = int((perf_counter() - t0) * 1000)
    elapsed["total"] = int((perf_counter() - overall_t0) * 1000)

    return SimulateResponse(
        simulation_id=simulation_id,
        analysis_id=req.analysis_id,
        question=req.question,
        responses=responses,
        elapsed_ms=elapsed,
    )
