"""LLM 다형성 추상 레이어 (BaseLLMService & 구현체) + 팩토리.

각 도메인의 TOOL/프롬프트/헬퍼는 schemas.py, 클라이언트는 clients.py에서 가져온다.
provider 정책은 provider.py(enforce_provider). 공개 wrapper 함수는 패키지 __init__.py.
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from collections.abc import Iterator

from models.schemas import PersonaHit, PopulationStats, SellingPoints

from .clients import anthropic_client, openai_client, resolve_sllm_model, sllm_client
from .config import (
    CLAUDE_HAIKU,
    CLAUDE_SONNET,
    COMMENTARY_PROMPT,
    COMMENTARY_PROMPT_OPENAI,
    MAX_PRODUCT_TEXT_CHARS,
    OPENAI_DEFAULT_MODEL,
    PERSONA_ANSWER_SYSTEM_OPENAI,
    QUERY_FILTER_EXTRACT_SYSTEM_OPENAI,
    REPORT_PROMPT,
    REPORT_PROMPT_OPENAI,
    SELLING_POINTS_PROMPT,
    SELLING_POINTS_PROMPT_OPENAI,
    SUGGEST_QUESTIONS_SYSTEM_OPENAI,
    SURVEY_PLACEHOLDER_PROMPT,
    SURVEY_PLACEHOLDER_PROMPT_OPENAI,
)
from .provider import DEFAULT_PROVIDER, LLMProvider, enforce_provider
from .schemas import (
    _PERSONA_ANSWER_SYSTEM,
    _QUERY_FILTER_EXTRACT_SYSTEM,
    _QUERY_FILTER_EXTRACT_TOOL,
    _SELLING_POINTS_TOOL,
    _SUGGEST_QUESTIONS_SYSTEM,
    _SUGGEST_QUESTIONS_TOOL,
    _SURVEY_PLACEHOLDER_TOOL,
    _anthropic_to_openai_tool,
    _build_placeholder_user_prompt,
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

    def stream_report(
        self,
        sp: SellingPoints,
        top_personas: list[PersonaHit],
        population: PopulationStats,
    ) -> Iterator[str]:
        """리포트를 청크(토큰) 단위로 스트리밍.

        기본 구현은 비스트리밍 결과를 한 번에 yield(스트리밍 미지원 provider 폴백).
        SLLM/OpenAI는 chat.completions stream=True로 오버라이드해 진짜 토큰 스트림을 낸다.
        """
        yield self.generate_report(sp, top_personas, population)

    @abstractmethod
    def generate_overall_commentary(self, stats: dict) -> str:
        pass

    @abstractmethod
    def generate_survey_placeholders(self, category: str) -> dict:
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
            max_tokens=2400,
            system=REPORT_PROMPT,
            messages=[{"role": "user", "content": context}],
        )
        parts = [b.text for b in msg.content if getattr(b, "type", None) == "text"]
        return "\n".join(parts).strip()

    def generate_overall_commentary(self, stats: dict) -> str:
        context = _format_context_for_commentary(stats)
        msg = anthropic_client().messages.create(
            model=CLAUDE_HAIKU,
            max_tokens=1400,
            system=COMMENTARY_PROMPT,
            messages=[{"role": "user", "content": context}],
        )
        parts = [b.text for b in msg.content if getattr(b, "type", None) == "text"]
        return "\n".join(parts).strip()

    def generate_survey_placeholders(self, category: str) -> dict:
        msg = anthropic_client().messages.create(
            model=CLAUDE_HAIKU,
            max_tokens=400,
            temperature=1.0,
            system=SURVEY_PLACEHOLDER_PROMPT,
            tools=[_SURVEY_PLACEHOLDER_TOOL],
            tool_choice={"type": "tool", "name": "submit_survey_placeholder"},
            messages=[{"role": "user", "content": _build_placeholder_user_prompt(category)}],
        )
        for block in msg.content:
            if block.type == "tool_use" and block.name == "submit_survey_placeholder":
                return dict(block.input)
        raise RuntimeError(f"Claude submit_survey_placeholder 누락. content={msg.content!r}")


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
        # sLLM은 게이트웨이가 호스팅 중인 단일 모델만 인식 — 호출자가 넘긴 model(UI 표시·
        # 기록용 라벨)을 그대로 보내면 서버 모델명과 불일치 시 404(NotFoundError). 다른 SLLMService
        # 메서드와 동일하게 resolve_sllm_model()로 실제 호스팅 모델을 사용해 서버 모델 교체에도
        # 자동 적응. (model 인자는 BaseLLMService 계약상 받지만 sLLM 경로에선 미사용 — Anthropic만 사용)
        completion = sllm_client().chat.completions.create(
            model=resolve_sllm_model(),
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
            max_tokens=2400,
            temperature=0.4,
            messages=[
                {"role": "system", "content": REPORT_PROMPT},
                {"role": "user", "content": context},
            ],
        )
        return (completion.choices[0].message.content or "").strip()

    def stream_report(
        self,
        sp: SellingPoints,
        top_personas: list[PersonaHit],
        population: PopulationStats,
    ) -> Iterator[str]:
        """sLLM 토큰 스트리밍 — chat.completions stream=True의 delta.content를 yield."""
        context = _format_context_for_report(sp, top_personas, population)
        stream = sllm_client().chat.completions.create(
            model=resolve_sllm_model(),
            max_tokens=2400,
            temperature=0.4,
            messages=[
                {"role": "system", "content": REPORT_PROMPT},
                {"role": "user", "content": context},
            ],
            stream=True,
        )
        for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta

    def generate_overall_commentary(self, stats: dict) -> str:
        context = _format_context_for_commentary(stats)
        completion = sllm_client().chat.completions.create(
            model=resolve_sllm_model(),
            max_tokens=1400,
            temperature=0.4,
            messages=[
                {"role": "system", "content": COMMENTARY_PROMPT},
                {"role": "user", "content": context},
            ],
        )
        return (completion.choices[0].message.content or "").strip()

    def generate_survey_placeholders(self, category: str) -> dict:
        completion = sllm_client().chat.completions.create(
            model=resolve_sllm_model(),
            max_tokens=400,
            temperature=0.95,
            messages=[
                {"role": "system", "content": SURVEY_PLACEHOLDER_PROMPT},
                {"role": "user", "content": _build_placeholder_user_prompt(category)},
            ],
            tools=[_anthropic_to_openai_tool(_SURVEY_PLACEHOLDER_TOOL)],
            tool_choice={"type": "function", "function": {"name": "submit_survey_placeholder"}},
        )
        msg = completion.choices[0].message
        if not msg.tool_calls:
            raise RuntimeError(f"sLLM submit_survey_placeholder 누락. {msg!r}")
        return json.loads(msg.tool_calls[0].function.arguments)


class OpenAILLMService(BaseLLMService):
    """OpenAI(상용) API 기반 — 입력/출력 길이 제한 없이 충실한 결과.

    sLLM과 동일한 OpenAI 호환 인터페이스(chat.completions + function tool)를 쓰되:
    - 클라이언트: 실제 OpenAI(api.openai.com) — openai_client()
    - 모델: 전역 설정(runtime_config.openai_model, 폴백 OPENAI_DEFAULT_MODEL)
    - 입력 truncate(MAX_PRODUCT_TEXT_CHARS)·출력 max_tokens 제한 없음 (대표 요구: 충실한 결과)
      gpt-5.x는 max_tokens 미지원이라 어차피 설정하지 않으며, 미설정 시 모델 최대 출력을 쓴다.
    """

    def _model(self) -> str:
        from services.runtime_config import load_llm_config

        return load_llm_config().get("openai_model") or OPENAI_DEFAULT_MODEL

    @staticmethod
    def _args(msg, label: str) -> dict:
        if not msg.tool_calls:
            raise RuntimeError(f"OpenAI {label} tool_calls 누락. content={msg.content!r}")
        raw = msg.tool_calls[0].function.arguments
        try:
            return json.loads(raw)
        except json.JSONDecodeError as e:
            raise RuntimeError(f"OpenAI {label} tool args JSON 파싱 실패: {raw!r}") from e

    def extract_selling_points(
        self, product_text: str, input_mode: str = "terms"
    ) -> SellingPoints:
        # 입력 truncate 없음 — 전체 product_text 사용(상용 API는 큰 컨텍스트).
        user_content = _input_mode_prefix(input_mode) + product_text
        completion = openai_client().chat.completions.create(
            model=self._model(),
            temperature=0.2,
            messages=[
                {"role": "system", "content": SELLING_POINTS_PROMPT_OPENAI},
                {"role": "user", "content": user_content},
            ],
            tools=[_anthropic_to_openai_tool(_SELLING_POINTS_TOOL)],
            tool_choice={"type": "function", "function": {"name": "record_selling_points"}},
        )
        args = self._args(completion.choices[0].message, "record_selling_points")
        return SellingPoints.model_validate(args)

    def extract_filter_from_query(self, query: str) -> dict:
        completion = openai_client().chat.completions.create(
            model=self._model(),
            temperature=0.2,
            messages=[
                {"role": "system", "content": QUERY_FILTER_EXTRACT_SYSTEM_OPENAI},
                {"role": "user", "content": query},
            ],
            tools=[_anthropic_to_openai_tool(_QUERY_FILTER_EXTRACT_TOOL)],
            tool_choice={"type": "function", "function": {"name": "extract_persona_filter"}},
        )
        args = self._args(completion.choices[0].message, "extract_persona_filter")
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
        completion = openai_client().chat.completions.create(
            model=self._model(),
            temperature=temperature,
            messages=[
                {"role": "system", "content": PERSONA_ANSWER_SYSTEM_OPENAI},
                {"role": "user", "content": user_prompt},
            ],
            tools=[_anthropic_to_openai_tool(tool)],
            tool_choice={"type": "function", "function": {"name": "submit_answer"}},
        )
        msg = completion.choices[0].message
        tokens = (
            completion.usage.prompt_tokens + completion.usage.completion_tokens
            if completion.usage
            else 0
        )
        return self._args(msg, "submit_answer"), tokens

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
        completion = openai_client().chat.completions.create(
            model=self._model(),
            temperature=0.4,
            messages=[
                {"role": "system", "content": SUGGEST_QUESTIONS_SYSTEM_OPENAI},
                {"role": "user", "content": user_prompt},
            ],
            tools=[_anthropic_to_openai_tool(_SUGGEST_QUESTIONS_TOOL)],
            tool_choice={"type": "function", "function": {"name": "submit_suggested_questions"}},
        )
        args = self._args(completion.choices[0].message, "submit_suggested_questions")
        qs = args.get("questions", []) or []
        return _normalize_suggested_questions(qs)

    def generate_report(
        self,
        sp: SellingPoints,
        top_personas: list[PersonaHit],
        population: PopulationStats,
    ) -> str:
        context = _format_context_for_report(sp, top_personas, population)
        completion = openai_client().chat.completions.create(
            model=self._model(),
            temperature=0.4,
            messages=[
                {"role": "system", "content": REPORT_PROMPT_OPENAI},
                {"role": "user", "content": context},
            ],
        )
        return (completion.choices[0].message.content or "").strip()

    def generate_overall_commentary(self, stats: dict) -> str:
        context = _format_context_for_commentary(stats)
        completion = openai_client().chat.completions.create(
            model=self._model(),
            temperature=0.4,
            messages=[
                {"role": "system", "content": COMMENTARY_PROMPT_OPENAI},
                {"role": "user", "content": context},
            ],
        )
        return (completion.choices[0].message.content or "").strip()

    def generate_survey_placeholders(self, category: str) -> dict:
        completion = openai_client().chat.completions.create(
            model=self._model(),
            temperature=0.95,
            messages=[
                {"role": "system", "content": SURVEY_PLACEHOLDER_PROMPT_OPENAI},
                {"role": "user", "content": _build_placeholder_user_prompt(category)},
            ],
            tools=[_anthropic_to_openai_tool(_SURVEY_PLACEHOLDER_TOOL)],
            tool_choice={"type": "function", "function": {"name": "submit_survey_placeholder"}},
        )
        return self._args(completion.choices[0].message, "submit_survey_placeholder")


# 팩토리 매핑 싱글톤
_SERVICES: dict[LLMProvider, BaseLLMService] = {
    "anthropic": AnthropicLLMService(),
    "sllm": SLLMService(),
    "openai": OpenAILLMService(),
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
