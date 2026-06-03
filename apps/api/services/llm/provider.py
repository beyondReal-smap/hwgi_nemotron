"""LLM provider 타입 + 호출 정책.

분석/의견/시뮬레이션/A·B/총평 등 모든 LLM 호출이 이 정책을 거쳐 provider를 확정한다.
"""

from __future__ import annotations

from typing import Literal

LLMProvider = Literal["anthropic", "sllm"]
# 기본 provider — 사내 sLLM(Qwen) 우선. Anthropic은 explicit하게 지정한 경우에만 사용.
DEFAULT_PROVIDER: LLMProvider = "sllm"


def enforce_provider(requested: LLMProvider = DEFAULT_PROVIDER) -> LLMProvider:
    """현재 LLM 호출 정책을 한곳에서 강제한다(Anthropic 호출 차단).

    분석/의견/시뮬레이션/A·B/총평 등 호출처에 흩어져 있던 `provider = "sllm"` 하드코딩을
    대체한다. 지금은 요청 provider를 무시하고 DEFAULT_PROVIDER(sLLM)로 고정한다.
    Anthropic 복귀 시 이 함수만 `return requested`로 바꾸면 전체가 한 번에 해제된다.
    """
    return DEFAULT_PROVIDER
