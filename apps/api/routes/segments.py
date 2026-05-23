"""세그먼트 CRUD API.

엔드포인트:
  POST   /api/segments                — 신규 세그먼트 저장
  GET    /api/segments                — 목록 (메타만)
  GET    /api/segments/{segment_id}   — 단건 조회 (persona_uuids 포함)
  DELETE /api/segments/{segment_id}   — 삭제
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field

from models.survey import Segment, TargetFilter
from services import segment_repo

router = APIRouter(prefix="/api/segments", tags=["segments"])


class SegmentCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str = Field("", max_length=500)
    filter: TargetFilter
    persona_uuids: list[str] = Field(..., min_length=1, max_length=10000)


class SegmentListResponse(BaseModel):
    items: list[dict]
    total: int
    limit: int
    offset: int


@router.post("", response_model=Segment, status_code=201)
def create_segment(req: SegmentCreateRequest) -> Segment:
    seg = Segment(
        id="",
        name=req.name,
        description=req.description,
        filter=req.filter,
        persona_uuids=req.persona_uuids,
        created_at=datetime.now(timezone.utc),
    )
    try:
        return segment_repo.create_segment(seg)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("", response_model=SegmentListResponse)
def list_segments_endpoint(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> SegmentListResponse:
    items, total = segment_repo.list_segments(limit=limit, offset=offset)
    return SegmentListResponse(items=items, total=total, limit=limit, offset=offset)


@router.get("/{segment_id}", response_model=Segment)
def get_segment_endpoint(segment_id: str) -> Segment:
    seg = segment_repo.get_segment(segment_id)
    if seg is None:
        raise HTTPException(status_code=404, detail="segment not found")
    return seg


@router.delete("/{segment_id}", status_code=204)
def delete_segment_endpoint(segment_id: str) -> Response:
    if not segment_repo.delete_segment(segment_id):
        raise HTTPException(status_code=404, detail="segment not found")
    return Response(status_code=204)
