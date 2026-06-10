"""방문 이벤트 수집 API."""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field

from routes.admin import _check_admin
from services.visitor_events import client_ip_hash, list_visits, rate_limited, record_visit

router = APIRouter(prefix="/api/visitors", tags=["visitors"])


class VisitorTrackRequest(BaseModel):
    visitor_id: str = Field(..., min_length=1, max_length=120)
    session_id: str = Field(..., min_length=1, max_length=120)
    path: str = Field(..., min_length=1, max_length=300)
    page_title: str | None = Field(default=None, max_length=200)
    referrer: str | None = Field(default=None, max_length=500)
    language: str | None = Field(default=None, max_length=80)
    timezone: str | None = Field(default=None, max_length=80)
    screen_width: int | None = Field(default=None, ge=0, le=100_000)
    screen_height: int | None = Field(default=None, ge=0, le=100_000)
    viewport_width: int | None = Field(default=None, ge=0, le=100_000)
    viewport_height: int | None = Field(default=None, ge=0, le=100_000)


@router.post("/track")
def track_visit(body: VisitorTrackRequest, request: Request) -> dict[str, str | bool]:
    if rate_limited(client_ip_hash(request)):
        raise HTTPException(status_code=429, detail="too many events")
    event_id = record_visit(body.model_dump(exclude_none=True), request)
    return {"ok": True, "event_id": event_id}


@router.get("")
def get_visits(
    limit: int = Query(default=200, ge=1, le=1000),
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict:
    _check_admin(x_admin_token)
    records = list_visits(limit)
    return {"items": records, "count": len(records)}
