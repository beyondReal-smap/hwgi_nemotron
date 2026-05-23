"""POST /api/analyze — 상품 텍스트를 받아 페르소나 매칭 결과·리포트 반환."""

from __future__ import annotations

import asyncio
import logging
from time import perf_counter

import numpy as np
from fastapi import APIRouter, HTTPException

from models.schemas import AnalyzeRequest, AnalyzeResponse
from services.llm import embed_text, extract_selling_points, generate_report
from services.opinions import generate_persona_opinions
from services.persistence import persist_analysis
from services.scoring import build_query_text, score_personas
from services.store import get_store

logger = logging.getLogger("personafit.analyze")

router = APIRouter(prefix="/api", tags=["analyze"])


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
    """상품설명서·약관 → 타겟 페르소나 + 반응도 + 페르소나별 의견 + 리포트."""
    elapsed: dict[str, int] = {}
    overall_t0 = perf_counter()

    # 1) 소구점 추출 (provider별)
    t0 = perf_counter()
    try:
        sp = await asyncio.to_thread(
            extract_selling_points, req.product_text, req.llm_provider
        )
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

    top_personas, bottom_personas, province_stats, district_stats, population_stats = (
        await asyncio.to_thread(score_personas, sp, query_vec, store)
    )
    elapsed["score"] = int((perf_counter() - t0) * 1000)

    if not top_personas:
        raise HTTPException(status_code=422, detail="매칭된 페르소나가 없습니다. 입력 조건이 너무 좁습니다.")

    # 4) 페르소나 의견 생성 (비용 및 API Rate Limit 방지를 위해 상/하위 각각 최대 20명만 의견 생성)
    sliced_top = top_personas[: req.top_k]
    opinion_top_subset = sliced_top[:20]
    opinion_bottom_subset = bottom_personas[:20]
    t0 = perf_counter()
    try:
        top_opinions_task = generate_persona_opinions(
            opinion_top_subset, sp, provider=req.llm_provider
        )
        bottom_opinions_task = generate_persona_opinions(
            opinion_bottom_subset, sp, provider=req.llm_provider
        )
        top_opinions, bottom_opinions = await asyncio.gather(
            top_opinions_task, bottom_opinions_task
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
        bottom_personas=bottom_personas,
        province_stats=province_stats,
        district_stats=district_stats,
        population_stats=population_stats,
        top_opinions=top_opinions,
        bottom_opinions=bottom_opinions,
        report_md=report_md,
        elapsed_ms=elapsed,
    )

    analysis_id = persist_analysis({
        "product_text": req.product_text[:500],  # 본문 일부만 (로그 비대화 방지)
        "selling_points": sp.model_dump(),
        "top_personas": [p.model_dump() for p in response.top_personas],
        "bottom_personas": [p.model_dump() for p in response.bottom_personas],
        "province_stats": [r.model_dump() for r in province_stats],
        "district_stats": [r.model_dump() for r in district_stats],
        "population_stats": population_stats.model_dump(),
        "top_opinions": [o.model_dump() for o in top_opinions],
        "bottom_opinions": [o.model_dump() for o in bottom_opinions],
        "report_md": report_md,
        "elapsed_ms": elapsed,
        "llm_provider": req.llm_provider,
    })
    response.analysis_id = analysis_id

    return response
