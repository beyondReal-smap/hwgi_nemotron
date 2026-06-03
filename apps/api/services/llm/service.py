"""LLM 다형성 추상 레이어 (BaseLLMService & 구현체) + 팩토리.

각 도메인의 TOOL/프롬프트/헬퍼는 schemas.py, 클라이언트는 clients.py에서 가져온다.
provider 정책은 provider.py(enforce_provider). 공개 wrapper 함수는 패키지 __init__.py.
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod

from models.schemas import PersonaHit, PopulationStats, SellingPoints

from .clients import anthropic_client, resolve_sllm_model, sllm_client
from .config import (
    CLAUDE_HAIKU,
    CLAUDE_SONNET,
    COMMENTARY_PROMPT,
    MAX_PRODUCT_TEXT_CHARS,
    REPORT_PROMPT,
    SELLING_POINTS_PROMPT,
)
from .provider import DEFAULT_PROVIDER, LLMProvider, enforce_provider
from .schemas import (
    _PERSONA_ANSWER_SYSTEM,
    _QUERY_FILTER_EXTRACT_SYSTEM,
    _QUERY_FILTER_EXTRACT_TOOL,
    _SELLING_POINTS_TOOL,
    _SUGGEST_QUESTIONS_SYSTEM,
    _SUGGEST_QUESTIONS_TOOL,
    _anthropic_to_openai_tool,
    _build_answer_prompt,
    _build_answer_tool_schema,
    _build_suggest_user_prompt,
    _fill_extract_defaults,
    _format_context_for_commentary,
    _format_context_for_report,
    _input_mode_prefix,
    _normalize_suggested_questions,
)


class BaseLLMService(ABC):
    """LLM 추상화용 Base 서비스 클래스."""

    @abstractmethod
    def extract_selling_points(
        self, product_text: str, input_mode: str = "terms"
    ) -> SellingPoints:
        pass

    @abstractmethod
    def extract_filter_from_query(self, query: str) -> dict:
        pass

    @abstractmethod
    def generate_persona_answer(
        self,
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
        model: str,
        temperature: float,
    ) -> tuple[dict, int]:
        pass

    @abstractmethod
    def generate_survey_questions(
        self,
        *,
        title: str,
        description: str,
        objective: str,
        target_summary: str,
        num: int = 5,
        existing_question_texts: list[str] | None = None,
    ) -> list[dict]:
        pass

    @abstractmethod
    def generate_report(
        self,
        sp: SellingPoints,
        top_personas: list[PersonaHit],
        population: PopulationStats,
    ) -> str:
        pass

    @abstractmethod
    def generate_overall_commentary(self, stats: dict) -> str:
        pass


class AnthropicLLMService(BaseLLMService):
    """Anthropic Claude API 기반 LLM 서비스 구현."""

    def extract_selling_points(
        self, product_text: str, input_mode: str = "terms"
    ) -> SellingPoints:
        truncated = product_text[:MAX_PRODUCT_TEXT_CHARS]
        user_content = _input_mode_prefix(input_mode) + truncated
        msg = anthropic_client().messages.create(
            model=CLAUDE_SONNET,
            max_tokens=1500,
            system=SELLING_POINTS_PROMPT,
            tools=[_SELLING_POINTS_TOOL],
            tool_choice={"type": "tool", "name": "record_selling_points"},
            messages=[{"role": "user", "content": user_content}],
        )
        for block in msg.content:
            if block.type == "tool_use" and block.name == "record_selling_points":
                return SellingPoints.model_validate(block.input)
        raise RuntimeError(f"Claude tool_use 응답 누락. content={msg.content!r}")

    def extract_filter_from_query(self, query: str) -> dict:
        msg = anthropic_client().messages.create(
            model=CLAUDE_HAIKU,
            max_tokens=400,
            system=_QUERY_FILTER_EXTRACT_SYSTEM,
            tools=[_QUERY_FILTER_EXTRACT_TOOL],
            tool_choice={"type": "tool", "name": "extract_persona_filter"},
            messages=[{"role": "user", "content": query}],
        )
        for block in msg.content:
            if block.type == "tool_use" and block.name == "extract_persona_filter":
                return _fill_extract_defaults(dict(block.input), query)
        raise RuntimeError(f"Claude tool_use 응답 누락. content={msg.content!r}")

    def generate_persona_answer(
        self,
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
        model: str,
        temperature: float,
    ) -> tuple[dict, int]:
        tool = _build_answer_tool_schema(question_type, options, scale_min, scale_max)
        user_prompt = _build_answer_prompt(
            profile=profile,
            survey_objective=survey_objective,
            question_text=question_text,
            question_type=question_type,
            options=options,
            scale_min=scale_min,
            scale_max=scale_max,
            scale_label_low=scale_label_low,
            scale_label_high=scale_label_high,
        )
        msg = anthropic_client().messages.create(
            model=model,
            max_tokens=400,
            temperature=temperature,
            system=_PERSONA_ANSWER_SYSTEM,
            tools=[tool],
            tool_choice={"type": "tool", "name": "submit_answer"},
            messages=[{"role": "user", "content": user_prompt}],
        )
        tokens = msg.usage.input_tokens + msg.usage.output_tokens
        for block in msg.content:
            if block.type == "tool_use" and block.name == "submit_answer":
                return dict(block.input), tokens
        raise RuntimeError(f"Claude submit_answer 누락. content={msg.content!r}")

    def generate_survey_questions(
        self,
        *,
        title: str,
        description: str,
        objective: str,
        target_summary: str,
        num: int = 5,
        existing_question_texts: list[str] | None = None,
    ) -> list[dict]:
        user_prompt = _build_suggest_user_prompt(
            title=title,
            description=description,
            objective=objective,
            target_summary=target_summary,
            num=num,
            existing_question_texts=existing_question_texts,
        )
        msg = anthropic_client().messages.create(
            model=CLAUDE_HAIKU,
            max_tokens=1500,
            system=_SUGGEST_QUESTIONS_SYSTEM,
            tools=[_SUGGEST_QUESTIONS_TOOL],
            tool_choice={"type": "tool", "name": "submit_suggested_questions"},
            messages=[{"role": "user", "content": user_prompt}],
        )
        for block in msg.content:
            if block.type == "tool_use" and block.name == "submit_suggested_questions":
                data = dict(block.input)
                qs: list[dict] = data.get("questions", []) or []
                return _normalize_suggested_questions(qs)
        raise RuntimeError(f"Claude tool_use 응답 누락. content={msg.content!r}")

    def generate_report(
        self,
        sp: SellingPoints,
        top_personas: list[PersonaHit],
        population: PopulationStats,
    ) -> str:
        context = _format_context_for_report(sp, top_personas, population)
        msg = anthropic_client().messages.create(
            model=CLAUDE_HAIKU,
            max_tokens=1600,
            system=REPORT_PROMPT,
            messages=[{"role": "user", "content": context}],
        )
        parts = [b.text for b in msg.content if getattr(b, "type", None) == "text"]
        return "\n".join(parts).strip()

    def generate_overall_commentary(self, stats: dict) -> str:
        context = _format_context_for_commentary(stats)
        msg = anthropic_client().messages.create(
            model=CLAUDE_HAIKU,
            max_tokens=900,
            system=COMMENTARY_PROMPT,
            messages=[{"role": "user", "content": context}],
        )
        parts = [b.text for b in msg.content if getattr(b, "type", None) == "text"]
        return "\n".join(parts).strip()


class SLLMService(BaseLLMService):
    """OpenAI 호환 sLLM vLLM API 기반 LLM 서비스 구현."""

    def extract_selling_points(
        self, product_text: str, input_mode: str = "terms"
    ) -> SellingPoints:
        truncated = product_text[:MAX_PRODUCT_TEXT_CHARS]
        user_content = _input_mode_prefix(input_mode) + truncated
        completion = sllm_client().chat.completions.create(
            model=resolve_sllm_model(),
            max_tokens=1500,
            temperature=0.2,
            messages=[
                {"role": "system", "content": SELLING_POINTS_PROMPT},
                {"role": "user", "content": user_content},
            ],
            tools=[_anthropic_to_openai_tool(_SELLING_POINTS_TOOL)],
            tool_choice={"type": "function", "function": {"name": "record_selling_points"}},
        )
        message = completion.choices[0].message
        if not message.tool_calls:
            raise RuntimeError(f"sLLM tool_calls 누락. content={message.content!r}")
        args_json = message.tool_calls[0].function.arguments
        try:
            args = json.loads(args_json)
        except json.JSONDecodeError as e:
            raise RuntimeError(f"sLLM tool args JSON 파싱 실패: {args_json!r}") from e
        return SellingPoints.model_validate(args)

    def extract_filter_from_query(self, query: str) -> dict:
        completion = sllm_client().chat.completions.create(
            model=resolve_sllm_model(),
            max_tokens=400,
            temperature=0.2,
            messages=[
                {"role": "system", "content": _QUERY_FILTER_EXTRACT_SYSTEM},
                {"role": "user", "content": query},
            ],
            tools=[_anthropic_to_openai_tool(_QUERY_FILTER_EXTRACT_TOOL)],
            tool_choice={"type": "function", "function": {"name": "extract_persona_filter"}},
        )
        msg = completion.choices[0].message
        if not msg.tool_calls:
            raise RuntimeError(f"sLLM tool_calls 누락. {msg!r}")
        args = json.loads(msg.tool_calls[0].function.arguments)
        return _fill_extract_defaults(args, query)

    def generate_persona_answer(
        self,
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
        model: str,
        temperature: float,
    ) -> tuple[dict, int]:
        tool = _build_answer_tool_schema(question_type, options, scale_min, scale_max)
        user_prompt = _build_answer_prompt(
            profile=profile,
            survey_objective=survey_objective,
            question_text=question_text,
            question_type=question_type,
            options=options,
            scale_min=scale_min,
            scale_max=scale_max,
            scale_label_low=scale_label_low,
            scale_label_high=scale_label_high,
        )
        completion = sllm_client().chat.completions.create(
            model=model,
            max_tokens=400,
            temperature=temperature,
            messages=[
                {"role": "system", "content": _PERSONA_ANSWER_SYSTEM},
                {"role": "user", "content": user_prompt},
            ],
            tools=[_anthropic_to_openai_tool(tool)],
            tool_choice={"type": "function", "function": {"name": "submit_answer"}},
        )
        msg = completion.choices[0].message
        tokens = (completion.usage.prompt_tokens + completion.usage.completion_tokens
                  if completion.usage else 0)
        if not msg.tool_calls:
            raise RuntimeError(f"sLLM tool_calls 누락. {msg!r}")
        args = json.loads(msg.tool_calls[0].function.arguments)
        return args, tokens

    def generate_survey_questions(
        self,
        *,
        title: str,
        description: str,
        objective: str,
        target_summary: str,
        num: int = 5,
        existing_question_texts: list[str] | None = None,
    ) -> list[dict]:
        user_prompt = _build_suggest_user_prompt(
            title=title,
            description=description,
            objective=objective,
            target_summary=target_summary,
            num=num,
            existing_question_texts=existing_question_texts,
        )
        completion = sllm_client().chat.completions.create(
            model=resolve_sllm_model(),
            max_tokens=1500,
            temperature=0.4,
            messages=[
                {"role": "system", "content": _SUGGEST_QUESTIONS_SYSTEM},
                {"role": "user", "content": user_prompt},
            ],
            tools=[_anthropic_to_openai_tool(_SUGGEST_QUESTIONS_TOOL)],
            tool_choice={"type": "function", "function": {"name": "submit_suggested_questions"}},
        )
        msg = completion.choices[0].message
        if not msg.tool_calls:
            raise RuntimeError(f"sLLM tool_calls 누락. {msg!r}")
        args = json.loads(msg.tool_calls[0].function.arguments)
        qs = args.get("questions", []) or []
        return _normalize_suggested_questions(qs)

    def generate_report(
        self,
        sp: SellingPoints,
        top_personas: list[PersonaHit],
        population: PopulationStats,
    ) -> str:
        context = _format_context_for_report(sp, top_personas, population)
        completion = sllm_client().chat.completions.create(
            model=resolve_sllm_model(),
            max_tokens=1600,
            temperature=0.4,
            messages=[
                {"role": "system", "content": REPORT_PROMPT},
                {"role": "user", "content": context},
            ],
        )
        return (completion.choices[0].message.content or "").strip()

    def generate_overall_commentary(self, stats: dict) -> str:
        context = _format_context_for_commentary(stats)
        completion = sllm_client().chat.completions.create(
            model=resolve_sllm_model(),
            max_tokens=900,
            temperature=0.4,
            messages=[
                {"role": "system", "content": COMMENTARY_PROMPT},
                {"role": "user", "content": context},
            ],
        )
        return (completion.choices[0].message.content or "").strip()


# 팩토리 매핑 싱글톤
_SERVICES: dict[LLMProvider, BaseLLMService] = {
    "anthropic": AnthropicLLMService(),
    "sllm": SLLMService(),
}


def get_llm_service(provider: LLMProvider = DEFAULT_PROVIDER) -> BaseLLMService:
    """LLM 프로바이더별 객체 인스턴스 팩토리.

    ⚠️ 현재 Anthropic 호출은 비활성 — enforce_provider로 모든 provider를 'sllm'으로 강제.
    AnthropicLLMService 코드는 SDK·향후 복귀를 위해 보존만. 해제는 provider.enforce_provider에서.
    """
    provider = enforce_provider(provider)  # 단일 호출 정책 (Anthropic 차단)
    if provider not in _SERVICES:
        raise ValueError(f"지원하지 않는 LLM 프로바이더: {provider}")
    return _SERVICES[provider]
