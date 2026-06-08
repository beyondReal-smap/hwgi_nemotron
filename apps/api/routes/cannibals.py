"""GET /api/cannibals, GET /api/cannibals/{id}, DELETE — 겹침 분석 이력 조회·삭제.

abtests와 동일 패턴. 단건은 dict 그대로 반환해 CannibalResponse 스키마와 자유롭게 호환.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from services.cannibal_persistence import (
    delete_all_cannibals,
    delete_cannibal,
    get_cannibal,
    list_cannibals,
)

router = APIRouter(prefix="/api", tags=["cannibals"])


class CannibalSummary(BaseModel):
    id: str
    created_at: str
    input_mode: Literal["terms", "marketing", "concept"]
    cohort_level: Literal["core", "target", "interest"]
    item_count: int
    labels: list[str]
    total_ms: int
    llm_provider: Literal["anthropic", "sllm", "openai"]


class CannibalsListResponse(BaseModel):
    total: int
    items: list[CannibalSummary]


@router.get("/cannibals", response_model=CannibalsListResponse)
def list_endpoint(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> CannibalsListResponse:
    """겹침 분석 이력 요약 리스트 (최신순)."""
    items, total = list_cannibals(limit=limit, offset=offset)
    return CannibalsListResponse(total=total, items=items)


@router.get("/cannibals/{cannibal_id}")
def detail_endpoint(cannibal_id: str) -> dict:
    """겹침 분석 단건 — CannibalResponse 호환 dict 반환."""
    rec = get_cannibal(cannibal_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"겹침 분석 이력 없음: {cannibal_id}")
    # 프론트 호환: cannibal_id 필드명 노출 (영속화는 id로 저장)
    if "cannibal_id" not in rec:
        rec["cannibal_id"] = rec.get("id", cannibal_id)
    return rec


@router.delete("/cannibals/{cannibal_id}")
def delete_endpoint(cannibal_id: str) -> dict:
    """단건 삭제."""
    if not delete_cannibal(cannibal_id):
        raise HTTPException(status_code=404, detail=f"겹침 분석 이력 없음: {cannibal_id}")
    return {"deleted": True, "id": cannibal_id}


@router.delete("/cannibals")
def delete_all_endpoint() -> dict:
    """전체 삭제."""
    count = delete_all_cannibals()
    return {"deleted": True, "cannibals": count}
