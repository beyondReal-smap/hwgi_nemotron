"""배치 설문 실행자 — asyncio 동시성 + 지수 백오프 재시도.

흐름 (run_survey 호출 시):
  1. survey.status = "running" 갱신
  2. 모든 persona_uuid에 대해 빈 session(pending) 미리 생성 (진행률 표시용)
  3. asyncio.Semaphore(CONCURRENCY)로 동시성 제한하며 페르소나 병렬 처리
  4. 각 페르소나 = 모든 질문을 순차 처리 + 답변마다 session 갱신
  5. 모두 완료 후 survey.status = "completed" 또는 "failed"
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from models.survey import Answer, ResponseSession, Survey
from services import survey_repo
from services.survey_engine import answer_one

logger = logging.getLogger("personafit.survey_run")

CONCURRENCY: int = 4                   # 동시 LLM 호출 상한 (sLLM Qwen 8개 동시 호출 시 응답 시간 3배 — 4 권장)
MAX_RETRIES: int = 3                   # 페르소나 단위 재시도
BACKOFF_BASE: float = 1.0              # 지수 백오프: 1, 2, 4초


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _retry(coro_fn, *, attempts: int = MAX_RETRIES):
    """비동기 함수 지수 백오프 재시도. 마지막 실패는 예외 재발생."""
    last_exc: Exception | None = None
    for i in range(attempts):
        try:
            return await coro_fn()
        except Exception as e:
            last_exc = e
            if i == attempts - 1:
                break
            wait = BACKOFF_BASE * (2 ** i)
            logger.warning("재시도 %d/%d (%.1fs 대기): %s", i + 1, attempts, wait, e)
            await asyncio.sleep(wait)
    assert last_exc is not None
    raise last_exc


async def _run_one_persona(
    *,
    survey: Survey,
    persona_uuid: str,
    semaphore: asyncio.Semaphore,
) -> None:
    """단일 페르소나의 모든 질문을 순차 처리 후 session 저장."""
    session = ResponseSession(
        id=f"{survey.id}:{persona_uuid}",
        survey_id=survey.id,
        persona_uuid=persona_uuid,
        status="running",
        started_at=_now(),
        llm_model_used=survey.execution.model,
    )
    survey_repo.upsert_session(session)

    answers: list[Answer] = []
    total_tokens = 0
    error: str | None = None

    # 진행률 UI 갱신을 위해 매 문항마다 session 점진 update (실시간 토큰 및 진행률 반영)
    PROGRESS_FLUSH_EVERY = 1

    try:
        for q_idx, q in enumerate(survey.questions, start=1):
            async with semaphore:
                async def call():
                    return await answer_one(
                        persona_uuid=persona_uuid,
                        question=q,
                        survey_objective=survey.objective,
                        provider=survey.execution.llm_provider,
                        model=survey.execution.model,
                        temperature=survey.execution.temperature,
                    )

                answer, tokens = await _retry(call)
                answers.append(answer)
                total_tokens += tokens

            # 점진 update — 3문항마다 disk flush로 진행률 노출
            if q_idx % PROGRESS_FLUSH_EVERY == 0:
                session.answers = list(answers)
                session.total_tokens = total_tokens
                survey_repo.upsert_session(session)
    except Exception as e:
        error = str(e)[:200]
        logger.exception("페르소나 %s 실패: %s", persona_uuid, e)

    session.answers = answers
    session.total_tokens = total_tokens
    session.completed_at = _now()
    session.status = "failed" if error else "completed"
    session.error = error
    survey_repo.upsert_session(session)


async def run_survey(survey: Survey) -> None:
    """설문 시뮬레이션 메인 진입점 (BackgroundTasks에서 호출).

    persona_uuids × questions LLM 호출 → sessions upsert → survey.status 갱신.
    """
    if not survey.persona_uuids:
        survey.status = "failed"
        survey.updated_at = _now()
        survey_repo.update_survey(survey)
        return

    # 1) survey 상태 running
    survey.status = "running"
    survey.updated_at = _now()
    survey_repo.update_survey(survey)
    logger.info(
        "run_survey 시작: id=%s, personas=%d, questions=%d, model=%s",
        survey.id, len(survey.persona_uuids), len(survey.questions), survey.execution.model,
    )

    # 2) 모든 페르소나 동시 처리 (semaphore로 상한)
    semaphore = asyncio.Semaphore(CONCURRENCY)
    tasks = [
        _run_one_persona(survey=survey, persona_uuid=uuid, semaphore=semaphore)
        for uuid in survey.persona_uuids
    ]
    await asyncio.gather(*tasks, return_exceptions=False)

    # 3) 최종 상태 결정
    counts = survey_repo.count_sessions(survey.id)
    failed = counts.get("failed", 0)
    completed = counts.get("completed", 0)

    if completed == 0:
        final_status = "failed"
    elif failed > 0 and completed == 0:
        final_status = "failed"
    else:
        # 1건이라도 성공이면 completed (실패는 부분 허용)
        final_status = "completed"

    survey.status = final_status
    survey.updated_at = _now()
    survey_repo.update_survey(survey)
    logger.info(
        "run_survey 완료: id=%s, status=%s, completed=%d, failed=%d",
        survey.id, final_status, completed, failed,
    )

    # 4) 차트 리포트 총평 생성 (completed인 경우만, best-effort — 실패해도 리포트 자체는 동작)
    if final_status == "completed":
        # I/O·LLM 호출을 이벤트 루프에서 분리. 실패는 commentary 모듈 내부에서 logging.
        from services.commentary import generate_and_persist
        await asyncio.to_thread(generate_and_persist, survey.id)


# ============================================================
# Startup 시 stale running 설문 자동 재개
# ============================================================

# 자동 재개 task 참조 보관 — GC로 사라지지 않도록 모듈 레벨 set에 보관.
# done 콜백에서 자동 제거하여 누수 방지.
_resume_tasks: set[asyncio.Task] = set()


def _reset_stale_sessions(survey: Survey) -> int:
    """running/pending/failed 세션을 pending으로 리셋. completed는 보존.

    `routes/survey_run.trigger_run`의 reset 로직과 동일한 처리를 startup 자동
    재개 경로에서도 수행. completed 세션은 답변 캐시로 즉시 통과되므로 처음부터
    다시 돌지 않는다.
    """
    from models.survey import ResponseSession
    reset = 0
    for uuid_str in survey.persona_uuids:
        existing = survey_repo.get_session(survey.id, uuid_str)
        if existing is None:
            survey_repo.upsert_session(ResponseSession(
                id=f"{survey.id}:{uuid_str}",
                survey_id=survey.id,
                persona_uuid=uuid_str,
                status="pending",
            ))
            reset += 1
        elif existing.status in ("failed", "running", "pending"):
            existing.status = "pending"
            existing.error = None
            existing.started_at = None
            existing.completed_at = None
            survey_repo.upsert_session(existing)
            reset += 1
    return reset


async def resume_stale_running_surveys() -> int:
    """앱 startup 시 status='running'인 설문을 자동 복구.

    수동 재시작·크래시로 BackgroundTask가 끊긴 설문을 다시 이어 돌린다.
    이벤트 루프 안에서 호출되므로 `asyncio.create_task`로 백그라운드 실행하고
    task 참조를 모듈 레벨 set에 보관한다(GC 방지).

    Returns: 재개된 설문 수
    """
    items, _ = survey_repo.list_surveys(status="running", limit=1000)
    resumed = 0
    for item in items:
        survey = survey_repo.get_survey(item["id"])
        if survey is None or not survey.persona_uuids or not survey.questions:
            continue
        reset = _reset_stale_sessions(survey)
        task = asyncio.create_task(run_survey(survey))
        _resume_tasks.add(task)
        task.add_done_callback(_resume_tasks.discard)
        logger.info(
            "stale survey 자동 재개: id=%s, personas=%d, reset=%d",
            survey.id, len(survey.persona_uuids), reset,
        )
        resumed += 1
    return resumed
