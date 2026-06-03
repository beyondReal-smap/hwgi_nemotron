"""LLM/임베딩 클라이언트 싱글톤 (앱 수명주기 1회 생성).

- anthropic_client / openai_client: API 키 검증 후 SDK 인스턴스
- sllm_client: OpenAI 호환 vLLM 엔드포인트
- resolve_sllm_model: env > /v1/models 자동 감지 (lazy + 캐싱)
"""

from __future__ import annotations

import os
from functools import lru_cache

from anthropic import Anthropic
from openai import OpenAI

from .config import SLLM_BASE_URL


@lru_cache(maxsize=1)
def anthropic_client() -> Anthropic:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise RuntimeError("ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.")
    return Anthropic()


@lru_cache(maxsize=1)
def sllm_client() -> OpenAI:
    """sLLM(OpenAI 호환) 싱글톤. vLLM은 api_key 미사용이지만 SDK 요구로 dummy 전달."""
    return OpenAI(base_url=SLLM_BASE_URL, api_key="dummy-sllm-no-auth")


@lru_cache(maxsize=1)
def resolve_sllm_model() -> str:
    """sLLM 모델명 결정 — env > /v1/models 자동 감지.

    우선순위:
    1. SLLM_MODEL 환경변수 (운영자 명시 override)
    2. /v1/models 응답의 첫 번째 모델 id (게이트웨이가 hosting 중인 실제 모델명)

    lru_cache로 1회만 resolve — 같은 프로세스 내에서 모델이 바뀌지 않는다고 가정.
    조회 실패 시 RuntimeError로 fail-fast (default 추측 금지: 잘못된 모델명은
    400/404를 유발하고 디버깅이 어려움).
    """
    env_model = os.environ.get("SLLM_MODEL")
    if env_model:
        return env_model
    try:
        models = sllm_client().models.list()
    except Exception as e:
        raise RuntimeError(
            f"sLLM 모델 자동 감지 실패: {SLLM_BASE_URL}/models 호출 중 오류 ({e}). "
            "SLLM_MODEL 환경변수로 모델명을 명시하거나 백엔드 상태를 확인하세요."
        ) from e
    data = list(getattr(models, "data", []) or [])
    if not data:
        raise RuntimeError(
            f"sLLM 모델 자동 감지 실패: {SLLM_BASE_URL}/models 응답에 모델이 없습니다 "
            "(백엔드 미기동 가능성). SLLM_MODEL 환경변수로 모델명을 명시하세요."
        )
    return data[0].id


@lru_cache(maxsize=1)
def openai_client() -> OpenAI:
    if not os.environ.get("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY 환경변수가 설정되지 않았습니다.")
    return OpenAI()
