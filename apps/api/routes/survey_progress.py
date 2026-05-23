"""GET /api/surveys/:id/status — 진행률 + 통계.
POST /api/surveys/:id/retry-failed — 실패한 페르소나만 재실행.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

from models.survey import ResponseSession, SurveyStatus
from services import survey_repo
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

    sessions = survey_repo.list_sessions(survey_id)

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
        answered_questions += len(s.answers or [])

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
