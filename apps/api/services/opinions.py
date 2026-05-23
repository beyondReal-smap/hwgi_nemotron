"""페르소나별 상품 의견 생성 — Haiku/sLLM 빙의로 1-2문장 의견을 병렬 생성.

설계:
- simulation.py와 동일한 패턴: 동기 LLM 콜을 asyncio.to_thread로 오프로드 + gather
- top + bottom 모두 같은 함수로 처리 (호출 측에서 따로 모음)
- 개별 호출 실패는 격리 (uuid 매칭 누락은 호출 측에서 처리)
"""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

from anthropic import Anthropic
from tenacity import retry, stop_after_attempt, wait_exponential

from models.schemas import PersonaHit, PersonaOpinion, SellingPoints
from services.llm import (
    CLAUDE_HAIKU,
    DEFAULT_PROVIDER,
    SLLM_MODEL,
    LLMProvider,
    _anthropic_to_openai_tool,
    anthropic_client,
    sllm_client,
)

logger = logging.getLogger("personafit.opinions")

PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"
PERSONA_OPINION_PROMPT = (PROMPTS_DIR / "persona_opinion.md").read_text(encoding="utf-8")


# ============================================================
# tool_use 스키마 — PersonaOpinion 메타 필드와 1:1
# ============================================================

_PERSONA_OPINION_TOOL = {
    "name": "record_persona_opinion",
    "description": "본인 입장에서 작성한 상품 의견을 구조화하여 보고합니다.",
    "input_schema": {
        "type": "object",
        "properties": {
            "opinion_text": {
                "type": "string",
                "description": "1-2문장의 본인 말투 의견 본문",
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
        "required": ["opinion_text", "sentiment", "purchase_intent"],
    },
}


# ============================================================
# 프롬프트 빌더
# ============================================================

def _build_demographics_line(p: PersonaHit) -> str:
    parts = [f"{p.sex} {p.age}세", f"{p.province} {p.district} 거주"]
    if p.occupation:
        parts.append(f"직업: {p.occupation}")
    if p.education_level:
        parts.append(f"학력: {p.education_level}")
    if p.family_type:
        parts.append(f"가구: {p.family_type}")
    if p.marital_status:
        parts.append(f"혼인: {p.marital_status}")
    return " / ".join(parts)


def _match_context(score: float) -> tuple[str, str]:
    """점수 → (match_band, match_hint).

    LLM이 점수를 직접 보고 강제 긍정·부정으로 몰지 않도록, 밴드 라벨과 한 줄 힌트만 노출.
    힌트는 "왜 이 사람이 매칭됐는지/안 됐는지"의 일반적 톤만 안내.
    """
    if score >= 80:
        return (
            "매우 높음",
            "데이터상 본인의 라이프스테이지·관심사·인구통계가 이 상품의 핵심 타겟에 잘 부합합니다.",
        )
    if score >= 65:
        return (
            "높음",
            "데이터상 본인이 이 상품에 관심을 가질 가능성이 평균 이상으로 평가됩니다.",
        )
    if score >= 40:
        return (
            "보통",
            "본인이 이 상품의 직접 타겟은 아니지만, 일부 혜택은 관심사와 겹칠 수 있습니다.",
        )
    if score >= 20:
        return (
            "낮음",
            "본인의 우선순위·생활 패턴과 이 상품의 핵심 혜택이 크게 겹치지 않을 가능성이 큽니다.",
        )
    return (
        "매우 낮음",
        "본인은 이 상품의 타겟층에서 멀고, 핵심 혜택이 본인 상황과 거의 무관할 수 있습니다.",
    )


def _render_prompt(p: PersonaHit, summary: str, key_benefits: list[str]) -> str:
    benefits_str = ", ".join(key_benefits) if key_benefits else "(별도 명시 없음)"
    band, hint = _match_context(p.score)
    return (
        PERSONA_OPINION_PROMPT
        .replace("{{persona_text}}", p.persona or "(프로필 텍스트 없음)")
        .replace("{{persona_demographics}}", _build_demographics_line(p))
        .replace("{{product_summary}}", summary)
        .replace("{{key_benefits}}", benefits_str)
        .replace("{{match_band}}", band)
        .replace("{{match_score}}", f"{p.score:.0f}")
        .replace("{{match_hint}}", hint)
    )


# ============================================================
# LLM 1콜 (동기) — to_thread로 비동기 컨텍스트에서 호출
# ============================================================

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def _call_llm_sync(prompt: str, provider: LLMProvider) -> dict:
    if provider == "anthropic":
        client: Anthropic = anthropic_client()
        msg = client.messages.create(
            model=CLAUDE_HAIKU,
            max_tokens=400,
            system=prompt,
            tools=[_PERSONA_OPINION_TOOL],
            tool_choice={"type": "tool", "name": "record_persona_opinion"},
            messages=[{"role": "user", "content": "위 프로필로 빙의하여 의견을 보고하세요."}],
        )
        for block in msg.content:
            if block.type == "tool_use" and block.name == "record_persona_opinion":
                return dict(block.input)
        raise RuntimeError(f"Haiku tool_use 응답 누락. content={msg.content!r}")

    # sLLM
    completion = sllm_client().chat.completions.create(
        model=SLLM_MODEL,
        max_tokens=400,
        temperature=0.7,
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": "위 프로필로 빙의하여 의견을 보고하세요."},
        ],
        tools=[_anthropic_to_openai_tool(_PERSONA_OPINION_TOOL)],
        tool_choice={"type": "function", "function": {"name": "record_persona_opinion"}},
    )
    message = completion.choices[0].message
    if not message.tool_calls:
        raise RuntimeError(f"sLLM tool_calls 누락. content={message.content!r}")
    return json.loads(message.tool_calls[0].function.arguments)


async def _opinion_one(
    p: PersonaHit,
    summary: str,
    key_benefits: list[str],
    provider: LLMProvider,
) -> PersonaOpinion:
    prompt = _render_prompt(p, summary, key_benefits)
    result = await asyncio.to_thread(_call_llm_sync, prompt, provider)
    return PersonaOpinion(
        persona_uuid=p.uuid,
        opinion_text=result["opinion_text"],
        sentiment=result["sentiment"],
        purchase_intent=int(result["purchase_intent"]),
        key_concern=result.get("key_concern"),
    )


# ============================================================
# 외부 진입점
# ============================================================

async def generate_persona_opinions(
    personas: list[PersonaHit],
    sp: SellingPoints,
    provider: LLMProvider = DEFAULT_PROVIDER,
) -> list[PersonaOpinion]:
    """페르소나 N명에 대해 병렬 의견 생성.

    실패한 페르소나는 결과 리스트에서 누락된다 (UI에서 uuid join 시 자연스럽게 비어 보임).
    return 리스트는 입력 personas 순서를 보존하되, 실패분은 제외.
    """
    if not personas:
        return []

    tasks = [_opinion_one(p, sp.summary, sp.key_benefits, provider) for p in personas]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    opinions: list[PersonaOpinion] = []
    for p, r in zip(personas, results, strict=True):
        if isinstance(r, PersonaOpinion):
            opinions.append(r)
        else:
            logger.warning("페르소나 %s 의견 생성 실패: %r", p.uuid, r)
    return opinions
