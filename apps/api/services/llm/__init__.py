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
- 임베딩은 KURE-v1 로컬 GPU 추론 (LLM provider 무관, lazy singleton)
"""

from __future__ import annotations

from collections.abc import Iterator

from openai import BadRequestError, UnprocessableEntityError
from tenacity import (
    retry,
    retry_if_not_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from models.schemas import PersonaHit, PopulationStats, SellingPoints
from services.pii_mask import mask_pii

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
from .embedding import embed_text, preload_embedder
from .provider import DEFAULT_PROVIDER, LLMProvider, enforce_provider
from .schemas import _anthropic_to_openai_tool
from .service import (
    AnthropicLLMService,
    BaseLLMService,
    OpenAILLMService,
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
    "embed_text", "preload_embedder",
    # schemas (외부 호출)
    "_anthropic_to_openai_tool",
    # service
    "BaseLLMService", "AnthropicLLMService", "SLLMService", "OpenAILLMService", "get_llm_service",
    # wrapper
    "extract_selling_points", "extract_filter_from_query", "generate_persona_answer",
    "generate_survey_questions", "generate_report", "stream_report", "generate_overall_commentary",
    "generate_survey_placeholders",
]


# ============================================================
# 공개 wrapper — provider 인자를 받아 get_llm_service에 위임
# ============================================================

# 4xx(PII 차단·잘못된 요청 등 클라이언트 오류)는 재시도해도 동일 실패 → 즉시 전파.
# 연결 오류·5xx·타임아웃 같은 일시적 장애만 재시도한다.
_NO_4XX_RETRY = retry_if_not_exception_type((UnprocessableEntityError, BadRequestError))

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8), retry=_NO_4XX_RETRY)
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
    product_text = mask_pii(product_text)  # PII(주민번호·카드번호 등) 마스킹 → sLLM 차단 회피 + 보안
    sp = get_llm_service(provider).extract_selling_points(product_text, input_mode)
    if input_mode == "marketing":
        sp.key_benefits = []
    # target_*(가구/직업/성별/학력)를 데이터셋 실제값으로 정규화 → scoring._rule_bonus의
    # 하드 isin/substring 매칭에 환각값('부부'·'1인 가구'·'IT'·'은퇴')이 직격해 차원이
    # 0매칭으로 희석되던 결함 차단 (페르소나 탐색과 동일한 매칭 보증을 분석계열에도 부여).
    from services.query_normalization import normalize_selling_points
    return normalize_selling_points(sp)


@retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=1, max=4), retry=_NO_4XX_RETRY)
def extract_filter_from_query(
    query: str, provider: LLMProvider = DEFAULT_PROVIDER,
) -> dict:
    """자연어 쿼리 → 메타 필터 dict. get_llm_service() 위임."""
    return get_llm_service(provider).extract_filter_from_query(query)


@retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=1, max=4), retry=_NO_4XX_RETRY)
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


@retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=1, max=4), retry=_NO_4XX_RETRY)
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


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8), retry=_NO_4XX_RETRY)
def generate_report(
    sp: SellingPoints,
    top_personas: list[PersonaHit],
    population: PopulationStats,
    provider: LLMProvider = DEFAULT_PROVIDER,
) -> str:
    """FP/기획자용 마크다운 리포트 (모집단 기반). get_llm_service() 위임."""
    return get_llm_service(provider).generate_report(sp, top_personas, population)


def stream_report(
    sp: SellingPoints,
    top_personas: list[PersonaHit],
    population: PopulationStats,
    provider: LLMProvider = DEFAULT_PROVIDER,
) -> Iterator[str]:
    """리포트 토큰 스트리밍 generator. get_llm_service() 위임.

    재시도 데코레이터를 붙이지 않는다 — generator는 호출 시점이 아니라 소비 시점에 실행돼
    @retry로 감싸도 효과가 없고, 스트림 도중 끊기면 이미 받은 토큰은 호출부가 보존한다.
    """
    return get_llm_service(provider).stream_report(sp, top_personas, population)


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8), retry=_NO_4XX_RETRY)
def generate_overall_commentary(
    stats: dict,
    provider: LLMProvider = DEFAULT_PROVIDER,
) -> str:
    """설문 차트 리포트 최상단 총평 마크다운 생성. get_llm_service() 위임."""
    return get_llm_service(provider).generate_overall_commentary(stats)


@retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=1, max=4), retry=_NO_4XX_RETRY)
def generate_survey_placeholders(
    category: str, provider: LLMProvider = DEFAULT_PROVIDER,
) -> dict:
    """설문 작성 폼 placeholder 예시 1세트 생성. get_llm_service() 위임."""
    return get_llm_service(provider).generate_survey_placeholders(category)
