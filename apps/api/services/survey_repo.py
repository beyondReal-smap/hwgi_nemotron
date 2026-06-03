"""설문 영속화 — JSON 파일 기반.

디스크 레이아웃:
  data/surveys/
    ├── _index.json                    # {survey_id: {title, status, updated_at}} 빠른 list
    ├── {survey_id}/
    │   ├── survey.json                # Survey 본체
    │   └── sessions/
    │       └── {persona_uuid}.json    # ResponseSession 1건

동시 쓰기 안전성:
  - 파일 쓰기는 atomic (tmp → fsync → rename)
  - survey_id 단위로 in-process lock (멀티 워커가 아닌 단일 uvicorn 기준)
"""

from __future__ import annotations

import json
import logging
import threading
import uuid
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel

from models.survey import ResponseSession, SessionStatus, Survey, SurveyStatus
from services.fileio import atomic_write_text

logger = logging.getLogger("personafit.survey_repo")

# 프로젝트 루트 기준 경로
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
BASE_DIR = _PROJECT_ROOT / "data" / "surveys"
INDEX_PATH = BASE_DIR / "_index.json"

_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock(key: str) -> threading.Lock:
    """survey_id 단위 락. 동시 update 시 데이터 손상 방지."""
    with _locks_guard:
        if key not in _locks:
            _locks[key] = threading.Lock()
        return _locks[key]


def _now() -> datetime:
    return datetime.now(UTC)


# 원자적 파일 쓰기는 services.fileio로 이관. 기존 호출부 호환을 위해 별칭만 유지.
_atomic_write = atomic_write_text


# ============================================================
# 인덱스 — 빠른 list_surveys용 (Survey 메타만)
# ============================================================

def _read_index() -> dict[str, dict]:
    if not INDEX_PATH.exists():
        return {}
    # 파일이 존재하는데 파싱 실패 = 손상. 무음 빈 목록으로 둔갑시키면 모든 설문이 사라진 것처럼
    # 보이고 원인 추적이 막힌다 → segment_repo._read_index와 동일하게 노출(fail-fast).
    try:
        return json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        logger.exception("설문 인덱스 손상/읽기 실패: %s", INDEX_PATH)
        raise


def _write_index_entry(survey: Survey) -> None:
    """인덱스에서 survey 메타만 갱신. 인덱스 자체 락은 별도."""
    with _lock("__index__"):
        idx = _read_index()
        idx[survey.id] = {
            "id": survey.id,
            "title": survey.title,
            "status": survey.status,
            "objective": survey.objective[:100],
            "question_count": len(survey.questions),
            "persona_count": len(survey.persona_uuids),
            "created_at": survey.created_at.isoformat(),
            "updated_at": survey.updated_at.isoformat(),
        }
        _atomic_write(INDEX_PATH, json.dumps(idx, ensure_ascii=False, indent=2))


def _delete_index_entry(survey_id: str) -> None:
    with _lock("__index__"):
        idx = _read_index()
        if survey_id in idx:
            del idx[survey_id]
            _atomic_write(INDEX_PATH, json.dumps(idx, ensure_ascii=False, indent=2))


# ============================================================
# Survey CRUD
# ============================================================

def _survey_path(survey_id: str) -> Path:
    return BASE_DIR / survey_id / "survey.json"


def _sessions_dir(survey_id: str) -> Path:
    return BASE_DIR / survey_id / "sessions"


def create_survey(survey: Survey) -> Survey:
    """신규 설문 저장. id가 비어있으면 uuid 발급."""
    if not survey.id:
        survey.id = str(uuid.uuid4())
    survey.created_at = survey.created_at or _now()
    survey.updated_at = _now()

    with _lock(survey.id):
        path = _survey_path(survey.id)
        if path.exists():
            raise ValueError(f"survey {survey.id} already exists")
        _atomic_write(path, survey.model_dump_json(indent=2))
    _write_index_entry(survey)
    return survey


def get_survey(survey_id: str) -> Survey | None:
    path = _survey_path(survey_id)
    if not path.exists():
        return None
    # 파일이 존재하는데 파싱 실패 = 손상/스키마 불일치라는 '진짜 버그'.
    # None으로 흡수하면 호출부에서 404로 둔갑해 디버깅이 어렵다 → 예외로 노출.
    try:
        return Survey.model_validate_json(path.read_text(encoding="utf-8"))
    except Exception:
        logger.exception("survey.json 파싱 실패 (손상 가능): %s", path)
        raise


def list_surveys(
    status: SurveyStatus | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict], int]:
    """인덱스 기반 빠른 목록 (Survey 본체는 로드하지 않음).

    Returns: (요약 메타 리스트, 전체 건수)
    """
    idx = _read_index()
    items = list(idx.values())
    if status:
        items = [i for i in items if i.get("status") == status]
    items.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
    total = len(items)
    return items[offset : offset + limit], total


def update_survey(survey: Survey) -> Survey:
    """존재하는 설문 갱신. updated_at 자동 갱신."""
    survey.updated_at = _now()
    with _lock(survey.id):
        path = _survey_path(survey.id)
        if not path.exists():
            raise ValueError(f"survey {survey.id} not found")
        _atomic_write(path, survey.model_dump_json(indent=2))
    _write_index_entry(survey)
    return survey


def try_mark_running(survey_id: str, *, force: bool = False) -> Survey | None:
    """status='running' 으로의 원자적 check-and-set.

    동시 POST /run race 방지: survey_id 락 안에서 (1) 현재 상태 재로드 →
    (2) 이미 running이고 force=False면 None 반환(claim 실패) → (3) 아니면
    running으로 set + 영속화 후 Survey 반환(claim 성공).

    Returns:
        claim 성공 시 갱신된 Survey, 이미 running(force=False)이면 None.
    Raises:
        FileNotFoundError: survey가 존재하지 않음.
    """
    with _lock(survey_id):
        path = _survey_path(survey_id)
        if not path.exists():
            raise FileNotFoundError(survey_id)
        # 락 안에서 디스크 최신값 재로드 (다른 요청이 막 running으로 바꿨을 수 있음)
        survey = Survey.model_validate_json(path.read_text(encoding="utf-8"))
        if survey.status == "running" and not force:
            return None
        survey.status = "running"
        survey.updated_at = _now()
        _atomic_write(path, survey.model_dump_json(indent=2))
    _write_index_entry(survey)
    return survey


def delete_survey(survey_id: str) -> bool:
    """설문 + 모든 세션 삭제. 1건 이상 지워지면 True."""
    survey_dir = BASE_DIR / survey_id
    if not survey_dir.exists():
        return False
    with _lock(survey_id):
        # 디렉토리 안의 모든 파일 제거 후 디렉토리 삭제
        for p in sorted(survey_dir.rglob("*"), reverse=True):
            try:
                if p.is_file():
                    p.unlink()
                else:
                    p.rmdir()
            except OSError:
                pass
        try:
            survey_dir.rmdir()
        except OSError:
            pass
    _delete_index_entry(survey_id)
    return True


# ============================================================
# ResponseSession (Survey 1:N)
# ============================================================

def _session_path(survey_id: str, persona_uuid: str) -> Path:
    return _sessions_dir(survey_id) / f"{persona_uuid}.json"


def session_exists(survey_id: str, persona_uuid: str) -> bool:
    return _session_path(survey_id, persona_uuid).exists()


def upsert_session(session: ResponseSession) -> ResponseSession:
    """세션 단건 저장(생성·갱신). survey_id+persona_uuid 단위 락."""
    key = f"{session.survey_id}:{session.persona_uuid}"
    with _lock(key):
        path = _session_path(session.survey_id, session.persona_uuid)
        _atomic_write(path, session.model_dump_json(indent=2))
    return session


def get_session(survey_id: str, persona_uuid: str) -> ResponseSession | None:
    path = _session_path(survey_id, persona_uuid)
    if not path.exists():
        return None
    # 파일 부재(None)와 파싱 실패(손상)를 구분: 존재하는데 깨진 세션을 None으로
    # 흡수하면 응답이 조용히 사라진다 → 로깅 후 예외로 상위에 노출.
    try:
        return ResponseSession.model_validate_json(path.read_text(encoding="utf-8"))
    except Exception:
        logger.exception("session.json 파싱 실패 (손상 가능): %s", path)
        raise


def list_sessions(survey_id: str) -> list[ResponseSession]:
    """단일 설문의 모든 세션 — 파일 시스템 스캔."""
    dir_ = _sessions_dir(survey_id)
    if not dir_.exists():
        return []
    sessions: list[ResponseSession] = []
    corrupt = 0
    for p in sorted(dir_.glob("*.json")):
        try:
            sessions.append(ResponseSession.model_validate_json(p.read_text(encoding="utf-8")))
        except Exception:
            # 단건 손상으로 목록 전체를 깨뜨리지 않되, 무음 skip은 금지 → 건별 로깅.
            corrupt += 1
            logger.exception("session.json 파싱 실패 (skip): %s", p)
    if corrupt:
        logger.error("list_sessions: survey=%s, 손상 세션 %d건 skip", survey_id, corrupt)
    return sessions


def count_sessions(survey_id: str) -> dict[str, int]:
    """상태별 세션 카운트. 진행률 표시용."""
    counts = {"pending": 0, "running": 0, "completed": 0, "failed": 0}
    for s in list_sessions(survey_id):
        counts[s.status] = counts.get(s.status, 0) + 1
    return counts


class SessionProgress(BaseModel):
    """진행률 polling 전용 경량 세션 뷰.

    survey_status가 매 polling마다 필요로 하는 스칼라 필드만 담는다.
    nested answers 배열 전체를 Pydantic 검증하는 대신 개수(answer_count)만 집계해
    polling 1회당 비용을 절감한다(BP-6).
    """

    persona_uuid: str
    status: SessionStatus
    started_at: datetime | None = None
    completed_at: datetime | None = None
    total_tokens: int = 0
    error: str | None = None
    answer_count: int = 0


def list_session_progress(survey_id: str) -> list[SessionProgress]:
    """진행률 집계용 경량 세션 목록.

    list_sessions가 매 polling마다 모든 answers를 full 모델 검증하던 비용을 줄인다.
    각 파일을 json.loads로 1회 파싱 후 필요한 스칼라 필드 + len(answers)만 추출한다.
    손상 파일은 list_sessions와 동일하게 건별 로깅 후 skip(목록 전체를 깨뜨리지 않음).
    """
    dir_ = _sessions_dir(survey_id)
    if not dir_.exists():
        return []
    out: list[SessionProgress] = []
    corrupt = 0
    for p in sorted(dir_.glob("*.json")):
        try:
            raw = json.loads(p.read_text(encoding="utf-8"))
            out.append(SessionProgress(
                persona_uuid=raw["persona_uuid"],
                status=raw.get("status", "pending"),
                started_at=raw.get("started_at"),
                completed_at=raw.get("completed_at"),
                total_tokens=raw.get("total_tokens", 0),
                error=raw.get("error"),
                answer_count=len(raw.get("answers") or []),
            ))
        except Exception:
            corrupt += 1
            logger.exception("session.json 경량 파싱 실패 (skip): %s", p)
    if corrupt:
        logger.error("list_session_progress: survey=%s, 손상 세션 %d건 skip", survey_id, corrupt)
    return out


# ============================================================
# 차트 리포트 총평 캐시 (data/surveys/<id>/commentary.json)
# ============================================================

def _commentary_path(survey_id: str) -> Path:
    return BASE_DIR / survey_id / "commentary.json"


def save_commentary(survey_id: str, *, text: str, provider: str) -> None:
    """총평 마크다운 텍스트 + 메타를 캐시. 설문 폴더가 없으면 생성."""
    path = _commentary_path(survey_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "text": text,
        "generated_at": _now().isoformat(),
        "provider": provider,
    }
    with _lock(survey_id):
        _atomic_write(path, json.dumps(payload, ensure_ascii=False, indent=2))


def load_commentary(survey_id: str) -> str | None:
    """캐시된 총평 텍스트 반환. 없으면 None (리포트는 commentary 없이도 표시)."""
    path = _commentary_path(survey_id)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        text = data.get("text")
        return str(text) if text else None
    except Exception:
        return None
