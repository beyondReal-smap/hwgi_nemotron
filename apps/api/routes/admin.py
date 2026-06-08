"""관리자 LLM 설정 API — 서버 전역 provider/모델 선택.

전역 설정(services.runtime_config)을 조회/갱신한다. enforce_provider()가 이 값을 모든
LLM 호출에 강제하므로, 여기서 provider를 바꾸면 분석·설문·A/B·총평·페르소나 응답이
일괄 전환된다. ADMIN_TOKEN(.env) 헤더로 보호한다(기존 commentary regenerate와 동일 패턴).
"""

from __future__ import annotations

import os

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from services.runtime_config import VALID_PROVIDERS, load_llm_config, save_llm_config

router = APIRouter(prefix="/api/admin", tags=["admin"])

# 관리자 페이지 모델 select용 추천 목록(자유 입력도 허용). OpenAI 키로 조회된 gpt 계열.
SUGGESTED_OPENAI_MODELS = ["gpt-5.4", "gpt-5.4-mini", "gpt-5.5", "gpt-5.5-pro", "gpt-5.2"]


def _check_admin(token: str | None) -> None:
    expected = os.environ.get("ADMIN_TOKEN", "").strip()
    if not expected:
        raise HTTPException(status_code=403, detail="admin disabled (ADMIN_TOKEN 미설정)")
    if token != expected:
        raise HTTPException(status_code=403, detail="invalid admin token")


class LLMConfigUpdate(BaseModel):
    provider: str = Field(..., description="sllm | anthropic | openai")
    openai_model: str = Field("gpt-5.4", max_length=100)


@router.get("/llm-config")
def get_config(
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict:
    """현재 전역 LLM 설정 + 선택 가능한 옵션."""
    _check_admin(x_admin_token)
    cfg = load_llm_config()
    return {
        **cfg,
        "valid_providers": list(VALID_PROVIDERS),
        "suggested_openai_models": SUGGESTED_OPENAI_MODELS,
    }


@router.post("/llm-config")
def set_config(
    body: LLMConfigUpdate,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict:
    """전역 LLM provider/모델 갱신 — 모든 LLM 호출에 즉시 반영."""
    _check_admin(x_admin_token)
    if body.provider not in VALID_PROVIDERS:
        raise HTTPException(
            status_code=400, detail=f"provider는 {VALID_PROVIDERS} 중 하나여야 합니다"
        )
    return save_llm_config(provider=body.provider, openai_model=body.openai_model)
