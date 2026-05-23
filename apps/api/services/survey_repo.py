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
import os
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from models.survey import ResponseSession, Survey, SurveyStatus

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
    return datetime.now(timezone.utc)


def _atomic_write(path: Path, content: str) -> None:
    """tmp 파일 → fsync → rename. 부분 쓰기 방지."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp_")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    except Exception:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise


# ============================================================
# 인덱스 — 빠른 list_surveys용 (Survey 메타만)
# ============================================================

def _read_index() -> dict[str, dict]:
    if not INDEX_PATH.exists():
        return {}
    try:
        return json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


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
    try:
        return Survey.model_validate_json(path.read_text(encoding="utf-8"))
    except Exception:
        return None


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
    try:
        return ResponseSession.model_validate_json(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def list_sessions(survey_id: str) -> list[ResponseSession]:
    """단일 설문의 모든 세션 — 파일 시스템 스캔."""
    dir_ = _sessions_dir(survey_id)
    if not dir_.exists():
        return []
    sessions: list[ResponseSession] = []
    for p in sorted(dir_.glob("*.json")):
        try:
            sessions.append(ResponseSession.model_validate_json(p.read_text(encoding="utf-8")))
        except Exception:
            continue
    return sessions


def count_sessions(survey_id: str) -> dict[str, int]:
    """상태별 세션 카운트. 진행률 표시용."""
    counts = {"pending": 0, "running": 0, "completed": 0, "failed": 0}
    for s in list_sessions(survey_id):
        counts[s.status] = counts.get(s.status, 0) + 1
    return counts


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
