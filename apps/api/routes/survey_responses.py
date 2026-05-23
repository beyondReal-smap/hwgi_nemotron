"""GET /api/surveys/:id/responses — 페르소나별 응답 조회.

페르소나 메타(store)와 ResponseSession을 join해서 페이지네이션 반환.
검색 q는 페르소나 텍스트(persona 컬럼) 부분 매칭.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from models.survey import ResponseSession
from services import survey_repo
from services.store import get_store

router = APIRouter(prefix="/api/surveys", tags=["survey_responses"])


class PersonaWithSession(BaseModel):
    persona_uuid: str
    sex: str
    age: int
    province: str
    district: str
    occupation: str
    family_type: str | None
    marital_status: str | None
    persona: str   # 페르소나 본문 (발췌)
    session: ResponseSession


class ResponsesResponse(BaseModel):
    survey_id: str
    total_personas: int            # completed + failed 합
    completed: int
    failed: int
    page: int
    page_size: int
    items: list[PersonaWithSession]


@router.get("/{survey_id}/responses", response_model=ResponsesResponse)
def get_responses(
    survey_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    q: str | None = Query(None, max_length=200, description="페르소나 텍스트 부분 매칭"),
    status_filter: str | None = Query(
        None,
        description='세션 상태 필터: "completed"/"failed"/"pending"/"running"',
    ),
) -> ResponsesResponse:
    survey = survey_repo.get_survey(survey_id)
    if survey is None:
        raise HTTPException(status_code=404, detail="survey not found")

    sessions = survey_repo.list_sessions(survey_id)

    # 진행 중 세션 제외 (응답 조회는 완료된 것만 의미 있음 — 단 사용자가 filter로 명시한 경우 노출)
    if status_filter:
        sessions = [s for s in sessions if s.status == status_filter]
    else:
        sessions = [s for s in sessions if s.status in ("completed", "failed")]

    completed = sum(1 for s in sessions if s.status == "completed")
    failed = sum(1 for s in sessions if s.status == "failed")

    # 페르소나 메타 join — store에서 한 번에 lookup
    store = get_store()
    persona_uuids = [s.persona_uuid for s in sessions]
    rows = store.df[store.df["uuid"].isin(persona_uuids)].set_index("uuid")

    # 검색 q는 페르소나 본문 부분 매칭
    if q:
        rows = rows[rows["persona"].fillna("").str.contains(q, regex=False, na=False)]
        sessions = [s for s in sessions if s.persona_uuid in rows.index]

    total = len(sessions)
    start = (page - 1) * page_size
    end = start + page_size
    page_sessions = sessions[start:end]

    items: list[PersonaWithSession] = []
    for s in page_sessions:
        if s.persona_uuid not in rows.index:
            continue
        r = rows.loc[s.persona_uuid]
        items.append(PersonaWithSession(
            persona_uuid=s.persona_uuid,
            sex=str(r.get("sex", "")),
            age=int(r.get("age", 0)),
            province=str(r.get("province", "")),
            district=str(r.get("district", "")),
            occupation=str(r.get("occupation", "") or ""),
            family_type=str(r["family_type"]) if r.get("family_type") else None,
            marital_status=str(r["marital_status"]) if r.get("marital_status") else None,
            persona=str(r.get("persona", "")),
            session=s,
        ))

    return ResponsesResponse(
        survey_id=survey_id,
        total_personas=total,
        completed=completed,
        failed=failed,
        page=page,
        page_size=page_size,
        items=items,
    )
