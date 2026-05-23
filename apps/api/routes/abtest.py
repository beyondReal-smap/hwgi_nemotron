"""POST /api/abtest — A/B 두 안을 동일 모집단에 동시 분석하고 비교·전략 리포트 반환.

설계:
- A·B 각각에 대해 [소구점 추출 → 임베딩 → 스코어링 → 의견 생성]을 asyncio.gather로 병렬화
- 병렬화 덕분에 단일 분석(~22초) 대비 체감 시간은 거의 동일
- 의견 수는 단일(top 20+bottom 20=40)보다 적게: A·B 각각 top 10만 (비용 통제, bottom 생략)
- 비교 표는 LLM 없이 services/comparison.py에서 정형 계산
- 당사 장단점·FP 전략 마크다운은 Phase 3에서 LLM 호출 추가 (현재는 자리표시자)
- 영속화는 data/abtests.jsonl (Phase 2부터 ON, UI 이력은 v2)
"""

from __future__ import annotations

import asyncio
import logging
from time import perf_counter

import numpy as np
from fastapi import APIRouter, HTTPException

from models.schemas import (
    ABTestRequest,
    ABTestResponse,
    ABVariantResult,
    PersonaHit,
    PersonaOpinion,
    PopulationStats,
    RegionStat,
    SellingPoints,
)
from services.abtest_llm import (
    generate_abtest_company_insights,
    generate_abtest_fp_strategy,
)
from services.abtest_persistence import persist_abtest
from services.comparison import build_comparison, recommend_variant
from services.llm import embed_text, extract_selling_points
from services.opinions import generate_persona_opinions
from services.scoring import build_query_text, score_personas
from services.store import get_store

logger = logging.getLogger("personafit.abtest")

router = APIRouter(prefix="/api", tags=["abtest"])

# A/B는 비교가 목적이므로 각 안에서 의견을 적게 생성 (비용 통제)
OPINIONS_PER_VARIANT = 10


# ============================================================
# 단일 안 분석 — analyze.py의 핵심 흐름을 함수화 (A·B 양쪽에 재사용)
# ============================================================

async def _analyze_one_variant(
    *,
    label: str,
    text: str,
    llm_provider: str,
    input_mode: str,
    top_k: int,
    timings: dict[str, int],
    timing_suffix: str,
) -> ABVariantResult:
    """단일 안 분석 — 소구점/임베딩/스코어링/의견 생성까지.

    input_mode("terms"|"marketing"|"concept")가 selling_points 추출 시
    LLM이 hallucination 없이 입력의 본질만 추출하도록 가드 prefix를 결정한다.
    """
    t0 = perf_counter()
    sp: SellingPoints = await asyncio.to_thread(
        extract_selling_points, text, llm_provider, input_mode
    )
    timings[f"extract_{timing_suffix}"] = int((perf_counter() - t0) * 1000)

    t0 = perf_counter()
    query_vec = np.array(
        await asyncio.to_thread(embed_text, build_query_text(sp)),
        dtype=np.float32,
    )
    timings[f"embed_{timing_suffix}"] = int((perf_counter() - t0) * 1000)

    t0 = perf_counter()
    store = get_store()
    top_personas: list[PersonaHit]
    province_stats: list[RegionStat]
    population_stats: PopulationStats
    top_personas, _bottom, province_stats, _district, population_stats = (
        await asyncio.to_thread(score_personas, sp, query_vec, store)
    )
    timings[f"score_{timing_suffix}"] = int((perf_counter() - t0) * 1000)

    if not top_personas:
        raise HTTPException(
            status_code=422,
            detail=f"'{label}' 안에 매칭된 페르소나가 없습니다. 입력 조건이 너무 좁습니다.",
        )

    sliced_top = top_personas[:top_k]
    opinion_subset = sliced_top[:OPINIONS_PER_VARIANT]

    t0 = perf_counter()
    top_opinions: list[PersonaOpinion] = await generate_persona_opinions(
        opinion_subset, sp, provider=llm_provider  # type: ignore[arg-type]
    )
    timings[f"opinions_{timing_suffix}"] = int((perf_counter() - t0) * 1000)

    return ABVariantResult(
        label=label,
        selling_points=sp,
        top_personas=sliced_top,
        province_stats=province_stats,
        population_stats=population_stats,
        top_opinions=top_opinions,
    )


@router.post("/abtest", response_model=ABTestResponse)
async def abtest(req: ABTestRequest) -> ABTestResponse:
    """A/B 두 안 동시 분석 + 비교 표 + (Phase 3) LLM 리포트."""
    overall_t0 = perf_counter()
    timings: dict[str, int] = {}

    logger.info(
        "A/B 테스트 시작 — mode=%s, baseline=%s, challenger=%s, A=%s(%d자), B=%s(%d자), provider=%s",
        req.input_mode,
        req.baseline_variant,
        req.challenger_kind,
        req.variant_a.label,
        len(req.variant_a.text),
        req.variant_b.label,
        len(req.variant_b.text),
        req.llm_provider,
    )

    # 1) A·B 동시 분석 (소구점·임베딩·스코어링·의견 모두 병렬)
    try:
        variant_a_result, variant_b_result = await asyncio.gather(
            _analyze_one_variant(
                label=req.variant_a.label,
                text=req.variant_a.text,
                llm_provider=req.llm_provider,
                input_mode=req.input_mode,
                top_k=req.top_k,
                timings=timings,
                timing_suffix="a",
            ),
            _analyze_one_variant(
                label=req.variant_b.label,
                text=req.variant_b.text,
                llm_provider=req.llm_provider,
                input_mode=req.input_mode,
                top_k=req.top_k,
                timings=timings,
                timing_suffix="b",
            ),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("A/B 분석 실패")
        raise HTTPException(status_code=502, detail=f"A/B 분석 오류: {e}") from e

    # 2) 비교 표 산출 (LLM 미사용)
    t0 = perf_counter()
    comparison = build_comparison(variant_a_result, variant_b_result)
    recommended = recommend_variant(variant_a_result, variant_b_result, comparison)
    timings["compare"] = int((perf_counter() - t0) * 1000)

    # 3) 당사 장단점 + FP 전략 — 두 LLM 콜을 병렬 실행 (서로 독립)
    t0 = perf_counter()
    try:
        insights_task = asyncio.to_thread(
            generate_abtest_company_insights,
            company_context=req.company_context,
            input_mode=req.input_mode,
            variant_a=variant_a_result,
            variant_b=variant_b_result,
            baseline_variant=req.baseline_variant,
            challenger_kind=req.challenger_kind,
            comparison=comparison,
            recommended=recommended,
            provider=req.llm_provider,
        )
        strategy_task = asyncio.to_thread(
            generate_abtest_fp_strategy,
            company_context=req.company_context,
            input_mode=req.input_mode,
            variant_a=variant_a_result,
            variant_b=variant_b_result,
            baseline_variant=req.baseline_variant,
            challenger_kind=req.challenger_kind,
            comparison=comparison,
            recommended=recommended,
            provider=req.llm_provider,
        )
        company_insights_md, fp_strategy_md = await asyncio.gather(
            insights_task, strategy_task
        )
    except Exception as e:
        logger.exception("A/B 리포트 LLM 생성 실패")
        raise HTTPException(status_code=502, detail=f"LLM(리포트) 오류: {e}") from e
    insights_strategy_ms = int((perf_counter() - t0) * 1000)
    # 두 호출이 병렬이므로 elapsed는 합쳐서 기록 (개별 측정은 호출 내부에서 가능하지만 단순화)
    timings["insights"] = insights_strategy_ms
    timings["strategy"] = insights_strategy_ms

    timings["total"] = int((perf_counter() - overall_t0) * 1000)

    abtest_id = persist_abtest({
        "input_mode": req.input_mode,
        "baseline_variant": req.baseline_variant,
        "challenger_kind": req.challenger_kind,
        "company_context": req.company_context[:500],  # 본문 일부만 영속화
        "variant_a": variant_a_result.model_dump(),
        "variant_b": variant_b_result.model_dump(),
        "comparison": comparison.model_dump(),
        "company_insights_md": company_insights_md,
        "fp_strategy_md": fp_strategy_md,
        "recommended_variant": recommended,
        "elapsed_ms": timings,
        "llm_provider": req.llm_provider,
    })

    return ABTestResponse(
        abtest_id=abtest_id,
        input_mode=req.input_mode,
        company_context=req.company_context,
        baseline_variant=req.baseline_variant,
        challenger_kind=req.challenger_kind,
        variant_a=variant_a_result,
        variant_b=variant_b_result,
        comparison=comparison,
        company_insights_md=company_insights_md,
        fp_strategy_md=fp_strategy_md,
        recommended_variant=recommended,  # type: ignore[arg-type]
        elapsed_ms=timings,
    )
