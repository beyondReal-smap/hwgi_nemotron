"""설문 응답 시뮬레이션 — 페르소나 N명에게 Haiku로 빙의 응답 생성.

설계:
- 페르소나 독립성 보장을 위해 1콜 batch 대신 **Haiku N콜 병렬** (asyncio.gather)
- 동기 Anthropic 클라이언트를 그대로 사용 (asyncio.to_thread로 오프로드)
  - 추가 의존성 없음, 5콜이라 스레드 풀 부담 없음
- tool_use로 응답 스키마 강제 (response_text + sentiment + purchase_intent + key_concern)
- 개별 페르소나 호출 실패는 격리 (return_exceptions=True)
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from anthropic import Anthropic
from tenacity import retry, stop_after_attempt, wait_exponential

from models.schemas import PersonaHit, PersonaResponse
from services.llm import (
    CLAUDE_HAIKU,
    DEFAULT_PROVIDER,
    SLLM_MODEL,
    LLMProvider,
    _anthropic_to_openai_tool,
    anthropic_client,
    sllm_client,
)

logger = logging.getLogger("personafit.simulation")

PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"
SURVEY_RESPONSE_PROMPT = (PROMPTS_DIR / "survey_response.md").read_text(encoding="utf-8")


# ============================================================
# tool_use 스키마 — PersonaResponse 메타 필드와 1:1
# ============================================================

_SURVEY_RESPONSE_TOOL = {
    "name": "record_survey_response",
    "description": "본인 입장에서 작성한 설문 응답을 구조화하여 보고합니다.",
    "input_schema": {
        "type": "object",
        "properties": {
            "response_text": {
                "type": "string",
                "description": "1-3문장의 본인 말투 응답 본문",
            },
            "sentiment": {
                "type": "string",
                "enum": ["긍정", "중립", "부정"],
            },
            "purchase_intent": {
                "type": "integer",
                "minimum": 1,
                "maximum": 5,
                "description": "가입 의향 1(절대 안 함) ~ 5(적극 가입)",
            },
            "key_concern": {
                "type": ["string", "null"],
                "description": "본인이 가장 신경 쓰는 한 가지 키워드 (없으면 null)",
            },
        },
        "required": ["response_text", "sentiment", "purchase_intent"],
    },
}


# ============================================================
# 페르소나 컨텍스트 빌더
# ============================================================

def _build_persona_summary(persona: PersonaHit) -> str:
    """식별용 한 줄 요약 (UI 카드 헤더용). 이름은 노출하지 않음."""
    parts = [f"{persona.sex} {persona.age}세", f"{persona.province} {persona.district}"]
    if persona.occupation:
        parts.append(persona.occupation)
    return " · ".join(parts)


def _build_demographics_line(persona: PersonaHit) -> str:
    """프롬프트 변수치환용 인구통계 한 줄."""
    parts = [f"{persona.sex} {persona.age}세", f"{persona.province} {persona.district} 거주"]
    if persona.occupation:
        parts.append(f"직업: {persona.occupation}")
    if persona.education_level:
        parts.append(f"학력: {persona.education_level}")
    if persona.family_type:
        parts.append(f"가구: {persona.family_type}")
    if persona.marital_status:
        parts.append(f"혼인: {persona.marital_status}")
    return " / ".join(parts)


def _render_prompt(persona: PersonaHit, product_summary: str, question: str) -> str:
    """survey_response.md의 {{변수}}를 실제 값으로 치환."""
    return (
        SURVEY_RESPONSE_PROMPT
        .replace("{{persona_text}}", persona.persona or "(프로필 텍스트 없음)")
        .replace("{{persona_demographics}}", _build_demographics_line(persona))
        .replace("{{product_summary}}", product_summary)
        .replace("{{question}}", question)
    )


# ============================================================
# Haiku 1콜 (동기) — to_thread로 비동기 컨텍스트에서 호출
# ============================================================

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def _call_llm_sync(prompt: str, provider: LLMProvider) -> dict:
    """provider별 tool 호출 1회 (동기). 응답 dict 반환.

    asyncio.to_thread로 호출되어 이벤트 루프 블로킹 없음.
    """
    if provider == "anthropic":
        client: Anthropic = anthropic_client()
        msg = client.messages.create(
            model=CLAUDE_HAIKU,
            max_tokens=600,
            system=prompt,
            tools=[_SURVEY_RESPONSE_TOOL],
            tool_choice={"type": "tool", "name": "record_survey_response"},
            messages=[{"role": "user", "content": "위 프로필로 빙의하여 설문에 응답하세요."}],
        )
        for block in msg.content:
            if block.type == "tool_use" and block.name == "record_survey_response":
                return dict(block.input)
        raise RuntimeError(f"Haiku tool_use 응답 누락. content={msg.content!r}")

    # sLLM
    import json as _json
    completion = sllm_client().chat.completions.create(
        model=SLLM_MODEL,
        max_tokens=600,
        temperature=0.7,  # 빙의 다양성을 위해 약간 높임
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": "위 프로필로 빙의하여 설문에 응답하세요."},
        ],
        tools=[_anthropic_to_openai_tool(_SURVEY_RESPONSE_TOOL)],
        tool_choice={"type": "function", "function": {"name": "record_survey_response"}},
    )
    message = completion.choices[0].message
    if not message.tool_calls:
        raise RuntimeError(f"sLLM tool_calls 누락. content={message.content!r}")
    return _json.loads(message.tool_calls[0].function.arguments)


async def _simulate_one(
    persona: PersonaHit,
    product_summary: str,
    question: str,
    provider: LLMProvider,
) -> PersonaResponse:
    """페르소나 1명 빙의 응답 생성 (비동기)."""
    prompt = _render_prompt(persona, product_summary, question)
    result = await asyncio.to_thread(_call_llm_sync, prompt, provider)

    return PersonaResponse(
        persona_uuid=persona.uuid,
        persona_summary=_build_persona_summary(persona),
        response_text=result["response_text"],
        sentiment=result["sentiment"],
        purchase_intent=int(result["purchase_intent"]),
        key_concern=result.get("key_concern"),
    )


# ============================================================
# 외부 진입점
# ============================================================

async def simulate_survey_responses(
    personas: list[PersonaHit],
    product_summary: str,
    question: str,
    n: int,
    provider: LLMProvider = DEFAULT_PROVIDER,
) -> list[PersonaResponse]:
    """상위 N명 페르소나에게 병렬 빙의 호출. 개별 실패는 격리하여 성공분만 반환."""
    targets = personas[:n]
    if not targets:
        return []

    tasks = [
        _simulate_one(p, product_summary, question, provider) for p in targets
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    responses: list[PersonaResponse] = []
    for persona, result in zip(targets, results, strict=True):
        if isinstance(result, PersonaResponse):
            responses.append(result)
        else:
            # 개별 실패는 로그만 남기고 계속 (UX: 4/5라도 보여주는 게 0/5보다 낫다)
            logger.warning(
                "페르소나 %s 시뮬레이션 실패: %r", persona.uuid, result
            )

    return responses
