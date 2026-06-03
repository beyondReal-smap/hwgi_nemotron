"""LLM 추상화 — Anthropic Claude 또는 OpenAI 호환 sLLM(vLLM).

기존 단일 모듈 services/llm.py를 레이어로 분해한 패키지. 공개 API와 import 경로
(services.llm.*)는 100% 호환 — 이 __init__이 모든 public 심볼을 re-export한다.

레이어:
- provider:  LLMProvider / DEFAULT_PROVIDER / enforce_provider (호출 정책)
- config:    모델·엔드포인트 상수 + 프롬프트 + 공통 enum
- clients:   anthropic / sllm / openai 클라이언트 싱글톤
- embedding: embed_text (+ per-key lock)
- schemas:   tool_use 스키마 + 프롬프트 빌더 + 컨텍스트 포매터
- service:   BaseLLMService + 2 구현체 + 팩토리(get_llm_service)
- (이 파일): 공개 wrapper 함수들 — get_llm_service에 위임

설계 원칙:
- 클라이언트는 앱 수명주기 싱글톤
- tenacity로 재시도
- 임베딩은 항상 OpenAI (sLLM 무관)
"""

from __future__ import annotations

from tenacity import retry, stop_after_attempt, wait_exponential

from models.schemas import PersonaHit, PopulationStats, SellingPoints

from .clients import (
    anthropic_client,
    openai_client,
    resolve_sllm_model,
    sllm_client,
)
from .config import (
    ABTEST_COMPANY_PROMPT,
    ABTEST_STRATEGY_PROMPT,
    CLAUDE_HAIKU,
    CLAUDE_SONNET,
    COMMENTARY_PROMPT,
    EMBED_DIM,
    EMBED_MODEL,
    MAX_PRODUCT_TEXT_CHARS,
    PROMPTS_DIR,
    REPORT_PROMPT,
    SELLING_POINTS_PROMPT,
    SLLM_BASE_URL,
)
from .embedding import embed_text
from .provider import DEFAULT_PROVIDER, LLMProvider, enforce_provider
from .schemas import _anthropic_to_openai_tool
from .service import (
    AnthropicLLMService,
    BaseLLMService,
    SLLMService,
    get_llm_service,
)

__all__ = [
    # provider
    "LLMProvider", "DEFAULT_PROVIDER", "enforce_provider",
    # config
    "CLAUDE_SONNET", "CLAUDE_HAIKU", "EMBED_MODEL", "EMBED_DIM", "SLLM_BASE_URL",
    "PROMPTS_DIR", "SELLING_POINTS_PROMPT", "REPORT_PROMPT", "COMMENTARY_PROMPT",
    "ABTEST_COMPANY_PROMPT", "ABTEST_STRATEGY_PROMPT", "MAX_PRODUCT_TEXT_CHARS",
    # clients
    "anthropic_client", "sllm_client", "resolve_sllm_model", "openai_client",
    # embedding
    "embed_text",
    # schemas (외부 호출)
    "_anthropic_to_openai_tool",
    # service
    "BaseLLMService", "AnthropicLLMService", "SLLMService", "get_llm_service",
    # wrapper
    "extract_selling_points", "extract_filter_from_query", "generate_persona_answer",
    "generate_survey_questions", "generate_report", "generate_overall_commentary",
]


# ============================================================
# 공개 wrapper — provider 인자를 받아 get_llm_service에 위임
# ============================================================

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def extract_selling_points(
    product_text: str,
    provider: LLMProvider = DEFAULT_PROVIDER,
    input_mode: str = "terms",
) -> SellingPoints:
    """상품 분석 → SellingPoints. get_llm_service() 위임.

    input_mode("terms" | "marketing" | "concept")에 따라 LLM이 hallucination 없이
    카피·컨셉 입력의 본질만 추출하도록 user message에 가드 prefix가 prepend된다.

    카피 모드 안전망: key_benefits를 강제로 빈 배열로 덮어쓴다. 카피 한 줄에는
    명시된 보장 혜택이 없으므로 LLM이 추론한 값(예: '전면적 케어')은 모두 hallucination.
    """
    sp = get_llm_service(provider).extract_selling_points(product_text, input_mode)
    if input_mode == "marketing":
        sp.key_benefits = []
    return sp


@retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=1, max=4))
def extract_filter_from_query(
    query: str, provider: LLMProvider = DEFAULT_PROVIDER,
) -> dict:
    """자연어 쿼리 → 메타 필터 dict. get_llm_service() 위임."""
    return get_llm_service(provider).extract_filter_from_query(query)


@retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=1, max=4))
def generate_persona_answer(
    *,
    profile: str,
    survey_objective: str,
    question_text: str,
    question_type: str,
    options: list[str] | None,
    scale_min: int | None,
    scale_max: int | None,
    scale_label_low: str | None,
    scale_label_high: str | None,
    provider: LLMProvider,
    model: str,
    temperature: float,
) -> tuple[dict, int]:
    """단일 페르소나 × 단일 질문 → get_llm_service() 위임."""
    return get_llm_service(provider).generate_persona_answer(
        profile=profile,
        survey_objective=survey_objective,
        question_text=question_text,
        question_type=question_type,
        options=options,
        scale_min=scale_min,
        scale_max=scale_max,
        scale_label_low=scale_label_low,
        scale_label_high=scale_label_high,
        model=model,
        temperature=temperature,
    )


@retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=1, max=4))
def generate_survey_questions(
    *,
    title: str,
    description: str,
    objective: str,
    target_summary: str,
    num: int = 5,
    existing_question_texts: list[str] | None = None,
    provider: LLMProvider = DEFAULT_PROVIDER,
) -> list[dict]:
    """설문 제목·목적·대상 → 추천 질문. get_llm_service() 위임."""
    return get_llm_service(provider).generate_survey_questions(
        title=title,
        description=description,
        objective=objective,
        target_summary=target_summary,
        num=num,
        existing_question_texts=existing_question_texts,
    )


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def generate_report(
    sp: SellingPoints,
    top_personas: list[PersonaHit],
    population: PopulationStats,
    provider: LLMProvider = DEFAULT_PROVIDER,
) -> str:
    """FP/기획자용 마크다운 리포트 (모집단 기반). get_llm_service() 위임."""
    return get_llm_service(provider).generate_report(sp, top_personas, population)


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def generate_overall_commentary(
    stats: dict,
    provider: LLMProvider = DEFAULT_PROVIDER,
) -> str:
    """설문 차트 리포트 최상단 총평 마크다운 생성. get_llm_service() 위임."""
    return get_llm_service(provider).generate_overall_commentary(stats)
