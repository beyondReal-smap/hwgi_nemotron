"""GET /api/surveys/:id/status — 진행률 + 통계.
POST /api/surveys/:id/retry-failed — 실패한 페르소나만 재실행.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import BaseModel, Field

from models.survey import Answer, Question, SurveyStatus
from services import survey_repo
from services.store import get_store
from services.survey_run import run_survey

logger = logging.getLogger("personafit.survey_progress")

router = APIRouter(prefix="/api/surveys", tags=["survey_progress"])


# ============================================================
# 응답 스키마
# ============================================================


class FailedPersonaInfo(BaseModel):
    persona_uuid: str
    error: str | None
    started_at: str | None  # ISO


class SessionCounts(BaseModel):
    pending: int = 0
    running: int = 0
    completed: int = 0
    failed: int = 0


class SurveyStatusResponse(BaseModel):
    survey_id: str
    survey_status: SurveyStatus
    total: int                        # persona_uuids 전체 수
    counts: SessionCounts
    completed_ratio: float            # completed / total (0.0~1.0) — 페르소나 단위
    answered_questions: int = 0       # 모든 세션의 답한 문항 누적
    total_planned_answers: int = 0    # total_personas × question_count
    answered_ratio: float = 0.0       # answered / planned — 문항 단위(더 즉각적)
    avg_response_seconds: float | None
    total_tokens: int
    failed_personas: list[FailedPersonaInfo] = Field(default_factory=list)


# ============================================================
# 엔드포인트
# ============================================================


@router.get("/{survey_id}/status", response_model=SurveyStatusResponse)
def survey_status(survey_id: str) -> SurveyStatusResponse:
    """진행률·통계 집계. polling으로 자주 호출되니 IO 최소화."""
    survey = survey_repo.get_survey(survey_id)
    if survey is None:
        raise HTTPException(status_code=404, detail="survey not found")

    # polling 전용 경량 뷰 — answers 배열 전체를 full 검증하지 않고 개수만 집계(BP-6).
    sessions = survey_repo.list_session_progress(survey_id)

    counts = SessionCounts()
    durations: list[float] = []
    total_tokens = 0
    answered_questions = 0
    failed: list[FailedPersonaInfo] = []

    for s in sessions:
        if s.status == "pending":
            counts.pending += 1
        elif s.status == "running":
            counts.running += 1
        elif s.status == "completed":
            counts.completed += 1
            if s.started_at and s.completed_at:
                durations.append((s.completed_at - s.started_at).total_seconds())
        elif s.status == "failed":
            counts.failed += 1
            failed.append(FailedPersonaInfo(
                persona_uuid=s.persona_uuid,
                error=s.error,
                started_at=s.started_at.isoformat() if s.started_at else None,
            ))
        total_tokens += s.total_tokens
        # 답한 문항 누적 — running 세션도 부분 답변이 저장돼 있으면 카운트
        answered_questions += s.answer_count

    total = len(survey.persona_uuids)
    question_count = len(survey.questions)
    total_planned = total * question_count
    completed_ratio = counts.completed / total if total > 0 else 0.0
    answered_ratio = answered_questions / total_planned if total_planned > 0 else 0.0
    avg_sec = sum(durations) / len(durations) if durations else None

    return SurveyStatusResponse(
        survey_id=survey_id,
        survey_status=survey.status,
        total=total,
        counts=counts,
        completed_ratio=round(completed_ratio, 4),
        answered_questions=answered_questions,
        total_planned_answers=total_planned,
        answered_ratio=round(answered_ratio, 4),
        avg_response_seconds=round(avg_sec, 2) if avg_sec is not None else None,
        total_tokens=total_tokens,
        failed_personas=failed[:50],  # 최대 50개만 (UI 부담 방지)
    )


# ============================================================
# 실시간 응답 라이브 피드 — '방금 답한 페르소나'가 흘러 들어오는 ticker
# ============================================================


class RecentAnswer(BaseModel):
    """라이브 피드 한 줄 — 막 완료된 한 페르소나의 마지막 답변.

    PII 보호(survey_response.md 집단성 원칙): UUID·이름 절대 비노출.
    성별/나이/지역 + 답변 본문(요약)만 노출한다.
    """

    persona_summary: str = Field(..., description='식별 불가 한 줄 (예: "여 34 · 서울 강남구")')
    question_text: str = Field(..., description="해당 답변의 질문")
    answer_text: str = Field(..., description="렌더된 답변 (선택지/점수/자유응답)")
    reasoning: str = Field("", description="간단한 응답 근거 (있으면)")
    completed_at: str | None = Field(None, description="완료 시각 ISO")


class RecentAnswersResponse(BaseModel):
    items: list[RecentAnswer]
    completed_total: int = Field(0, description="완료 세션 누적 수 (피드 갱신 트리거용)")


def _persona_oneliner(row) -> str:
    """페르소나 행 → PII 없는 한 줄 요약. 행 없으면 빈 표기."""
    if row is None:
        return "익명 응답자"
    sex = str(row.get("sex", "") or "")
    sex_short = {"남자": "남", "여자": "여"}.get(sex, sex)
    age = row.get("age")
    # NaN은 `is not None`을 통과하나 int(NaN)→ValueError(500). 안전 변환.
    age_str = ""
    if age is not None and age == age:  # NaN != NaN
        try:
            age_str = str(int(age))
        except (ValueError, TypeError):
            age_str = ""
    province = str(row.get("province", "") or "")
    district = str(row.get("district", "") or "")
    # district는 "시도-시군구" 형식 → 시군구만 추출해 시도와 함께 표기
    district_suffix = district.split("-", 1)[-1] if "-" in district else district
    region = " ".join(p for p in (province, district_suffix) if p)
    head = " ".join(s for s in (sex_short, age_str) if s)
    return " · ".join(p for p in (head, region) if p) or "익명 응답자"


def _render_answer(ans: Answer, q: Question | None) -> str:
    """answer_value를 사람이 읽는 한 줄로. 유형별 분기."""
    v = ans.answer_value
    if isinstance(v, list):
        text = " · ".join(str(x) for x in v)
    elif isinstance(v, int) and q is not None and q.type in ("scale", "nps"):
        text = f"{v}점"
    else:
        text = str(v)
    return text[:120]


@router.get("/{survey_id}/recent-answers", response_model=RecentAnswersResponse)
def recent_answers(
    survey_id: str, limit: int = Query(8, ge=1, le=20)
) -> RecentAnswersResponse:
    """막 완료된 페르소나들의 마지막 답변 N개 (완료 시각 내림차순).

    진행 화면의 라이브 ticker용. status와 분리한 별도 경량 엔드포인트라 polling
    부담을 status에 얹지 않는다. LLM 호출 0(저장된 세션 슬라이스), PII 비노출.
    """
    survey = survey_repo.get_survey(survey_id)
    if survey is None:
        raise HTTPException(status_code=404, detail="survey not found")

    sessions = survey_repo.list_sessions(survey_id)
    qmap: dict[str, Question] = {q.id: q for q in survey.questions}

    completed = [
        s for s in sessions
        if s.status == "completed" and s.answers and s.completed_at is not None
    ]
    completed.sort(key=lambda s: s.completed_at or datetime.min, reverse=True)

    store = get_store()
    items: list[RecentAnswer] = []
    for s in completed[:limit]:
        ans = s.answers[-1]  # 가장 최근 답한 문항 = '방금 한 답'
        q = qmap.get(ans.question_id)
        row = store.get_row_by_uuid(s.persona_uuid)
        items.append(
            RecentAnswer(
                persona_summary=_persona_oneliner(row),
                question_text=(q.text if q is not None else ""),
                answer_text=_render_answer(ans, q),
                reasoning=(ans.reasoning or "")[:120],
                completed_at=s.completed_at.isoformat() if s.completed_at else None,
            )
        )

    return RecentAnswersResponse(items=items, completed_total=len(completed))


class RetryResponse(BaseModel):
    status: Literal["started", "noop"]
    survey_id: str
    retry_count: int


def _background_retry(survey_id: str) -> None:
    """failed 세션만 다시 pending으로 만들고 run_survey 트리거 (이미 completed는 캐시로 즉시 통과)."""
    survey = survey_repo.get_survey(survey_id)
    if survey is None:
        logger.error("재시도 중 survey 사라짐: %s", survey_id)
        return
    try:
        asyncio.run(run_survey(survey))
    except Exception:
        logger.exception("재시도 run_survey 실패: %s", survey_id)


@router.post("/{survey_id}/retry-failed", response_model=RetryResponse, status_code=202)
def retry_failed(survey_id: str, bg: BackgroundTasks) -> RetryResponse:
    """failed 상태 세션만 다시 실행. completed는 캐시 hit으로 즉시 통과."""
    survey = survey_repo.get_survey(survey_id)
    if survey is None:
        raise HTTPException(status_code=404, detail="survey not found")
    if survey.status == "running":
        raise HTTPException(status_code=409, detail="이미 실행 중입니다")

    sessions = survey_repo.list_sessions(survey_id)
    failed_uuids = [s.persona_uuid for s in sessions if s.status == "failed"]
    if not failed_uuids:
        return RetryResponse(status="noop", survey_id=survey_id, retry_count=0)

    # failed → pending 으로 재설정
    for uuid in failed_uuids:
        existing = survey_repo.get_session(survey_id, uuid)
        if existing:
            existing.status = "pending"
            existing.error = None
            existing.started_at = None
            existing.completed_at = None
            survey_repo.upsert_session(existing)

    bg.add_task(_background_retry, survey_id)
    return RetryResponse(status="started", survey_id=survey_id, retry_count=len(failed_uuids))
