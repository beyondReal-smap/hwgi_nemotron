"""GET /api/abtests, GET /api/abtests/{id}, DELETE — A/B 테스트 이력 조회·삭제.

analyses와 동일 패턴. response_model은 list 응답만 강제, 단건은 dict 그대로 반환해
ABTestResponse 스키마(추가 메타 포함)와 자유롭게 호환.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from services.abtest_persistence import (
    delete_abtest,
    delete_all_abtests,
    get_abtest,
    list_abtests,
)

router = APIRouter(prefix="/api", tags=["abtests"])


class ABTestSummary(BaseModel):
    id: str
    created_at: str
    input_mode: Literal["terms", "marketing", "concept"]
    baseline_variant: Literal["A", "B"]
    challenger_kind: Literal["internal", "external"]
    label_a: str
    label_b: str
    baseline_label: str
    challenger_label: str
    recommended_variant: Literal["A", "B", "split"]
    recommended_label: str
    total_ms: int
    llm_provider: Literal["anthropic", "sllm"]


class ABTestsListResponse(BaseModel):
    total: int
    items: list[ABTestSummary]


@router.get("/abtests", response_model=ABTestsListResponse)
def list_endpoint(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> ABTestsListResponse:
    """A/B 테스트 이력 요약 리스트 (최신순)."""
    items, total = list_abtests(limit=limit, offset=offset)
    return ABTestsListResponse(total=total, items=items)


@router.get("/abtests/{abtest_id}")
def detail_endpoint(abtest_id: str) -> dict:
    """A/B 테스트 단건 — ABTestResponse 호환 dict 반환.

    옛 레코드의 누락 필드는 abtest_persistence.get_abtest에서 기본값으로 채워짐.
    """
    rec = get_abtest(abtest_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"A/B 테스트 이력 없음: {abtest_id}")
    # 프론트 호환: abtest_id 필드명 노출 (영속화는 id로 저장)
    if "abtest_id" not in rec:
        rec["abtest_id"] = rec.get("id", abtest_id)
    return rec


@router.delete("/abtests/{abtest_id}")
def delete_endpoint(abtest_id: str) -> dict:
    """단건 삭제."""
    deleted = delete_abtest(abtest_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"A/B 테스트 이력 없음: {abtest_id}")
    return {"deleted": True, "id": abtest_id}


@router.delete("/abtests")
def delete_all_endpoint() -> dict:
    """전체 삭제."""
    count = delete_all_abtests()
    return {"deleted": True, "abtests": count}
