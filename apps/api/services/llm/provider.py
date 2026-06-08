"""LLM provider 타입 + 호출 정책.

분석/의견/시뮬레이션/A·B/총평 등 모든 LLM 호출이 이 정책을 거쳐 provider를 확정한다.
"""

from __future__ import annotations

from typing import Literal, cast

LLMProvider = Literal["anthropic", "sllm", "openai"]
# 폴백 provider — 전역 설정 파일이 없거나 손상됐을 때.
DEFAULT_PROVIDER: LLMProvider = "sllm"


def enforce_provider(requested: LLMProvider = DEFAULT_PROVIDER) -> LLMProvider:
    """서버 전역 LLM 설정(runtime_config)의 provider를 모든 호출에 강제한다.

    분석/의견/시뮬레이션/A·B/총평/페르소나 응답 등 호출처가 보낸 `requested` provider는
    무시하고, 관리자 페이지에서 정한 **전역 provider**(sllm | anthropic | openai)를 적용한다.
    관리자가 OpenAI를 고르면 모든 기능이 OpenAI(gpt-5.4 등)로, sLLM을 고르면 sLLM으로 일괄 전환.
    """
    from services.runtime_config import VALID_PROVIDERS, load_llm_config

    provider = load_llm_config().get("provider", DEFAULT_PROVIDER)
    if provider not in VALID_PROVIDERS:
        return DEFAULT_PROVIDER
    return cast(LLMProvider, provider)
