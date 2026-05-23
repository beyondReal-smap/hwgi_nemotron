"""POST /api/surveys/:id/run — 설문 시뮬레이션 시작 (백그라운드)."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException

from models.survey import ResponseSession
from services import survey_repo
from services.survey_run import run_survey

logger = logging.getLogger("personafit.survey_run_route")

router = APIRouter(prefix="/api/surveys", tags=["survey_run"])


def _background_run(survey_id: str) -> None:
    """BackgroundTasks 진입점. survey를 다시 로드해서 비동기 실행자 트리거."""
    survey = survey_repo.get_survey(survey_id)
    if survey is None:
        logger.error("배경 실행 중 survey 사라짐: %s", survey_id)
        return
    try:
        asyncio.run(run_survey(survey))
    except Exception:
        logger.exception("run_survey 비동기 실행 실패: %s", survey_id)


@router.post("/{survey_id}/run", status_code=202)
def trigger_run(
    survey_id: str,
    bg: BackgroundTasks,
    force: bool = False,
) -> dict:
    """설문 시뮬레이션 시작 (백그라운드).

    Args:
        force: True이면 status='running'이라도 강제로 다시 시작.
               pm2 재시작 등으로 백그라운드 작업이 끊겨 세션이 stale running으로 남았을 때 복구용.
               completed 세션은 보존(캐시 hit으로 즉시 통과), running/failed 세션은 pending으로 리셋.

    Returns:
        {status: "started", survey_id, total, reset, completed_preserved}
    """
    survey = survey_repo.get_survey(survey_id)
    if survey is None:
        raise HTTPException(status_code=404, detail="survey not found")
    if survey.status == "running" and not force:
        raise HTTPException(
            status_code=409,
            detail="이미 실행 중입니다. 강제 재시작은 ?force=true 또는 별도 액션 사용",
        )
    if not survey.persona_uuids:
        raise HTTPException(status_code=400, detail="대상 페르소나가 비어 있습니다")
    if not survey.questions:
        raise HTTPException(status_code=400, detail="질문이 1개 이상 필요합니다")

    now = datetime.now(timezone.utc)

    # 세션 정리:
    #   - 없으면 → pending 신규 생성
    #   - failed → pending 리셋
    #   - running → (force이거나 일반) pending 리셋  ← stale 복구
    #   - completed → 그대로 보존 (캐시 hit으로 즉시 통과될 것)
    reset_count = 0
    completed_preserved = 0
    for uuid in survey.persona_uuids:
        existing = survey_repo.get_session(survey.id, uuid)
        if existing is None:
            survey_repo.upsert_session(ResponseSession(
                id=f"{survey.id}:{uuid}",
                survey_id=survey.id,
                persona_uuid=uuid,
                status="pending",
            ))
            reset_count += 1
        elif existing.status in ("failed", "running", "pending"):
            existing.status = "pending"
            existing.error = None
            existing.started_at = None
            existing.completed_at = None
            survey_repo.upsert_session(existing)
            reset_count += 1
        else:
            # completed → 보존
            completed_preserved += 1

    bg.add_task(_background_run, survey.id)
    logger.info(
        "run 트리거: id=%s, personas=%d, questions=%d, force=%s, reset=%d, kept=%d",
        survey.id, len(survey.persona_uuids), len(survey.questions),
        force, reset_count, completed_preserved,
    )

    return {
        "status": "started",
        "survey_id": survey.id,
        "total": len(survey.persona_uuids),
        "questions": len(survey.questions),
        "reset": reset_count,
        "completed_preserved": completed_preserved,
        "started_at": now.isoformat(),
    }
