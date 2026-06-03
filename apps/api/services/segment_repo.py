"""세그먼트 영속화 — 저장된 페르소나 그룹.

디스크 레이아웃:
  data/segments/
    ├── _index.json              # {segment_id: meta}
    └── {segment_id}.json        # Segment 본체
"""

from __future__ import annotations

import json
import logging
import threading
import uuid
from datetime import UTC, datetime
from pathlib import Path

from models.survey import Segment
from services.fileio import atomic_write_text

logger = logging.getLogger("personafit.segment_repo")

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
BASE_DIR = _PROJECT_ROOT / "data" / "segments"
INDEX_PATH = BASE_DIR / "_index.json"

_lock = threading.Lock()


def _now() -> datetime:
    return datetime.now(UTC)


# 원자적 파일 쓰기는 services.fileio로 이관. 기존 호출부 호환을 위해 별칭만 유지.
_atomic_write = atomic_write_text


def _read_index() -> dict[str, dict]:
    # 파일 부재는 정상(아직 세그먼트 없음) → 빈 인덱스.
    # 파일이 존재하는데 파싱/읽기 실패는 데이터 손상이므로 삼키지 않고(빈 {}로 모든
    # 세그먼트를 '없음'으로 둔갑시키지 않고) 로깅 후 재발생한다 (fail-fast).
    if not INDEX_PATH.exists():
        return {}
    try:
        return json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        logger.exception("세그먼트 인덱스 손상/읽기 실패: %s", INDEX_PATH)
        raise


def _segment_path(segment_id: str) -> Path:
    return BASE_DIR / f"{segment_id}.json"


def create_segment(segment: Segment) -> Segment:
    if not segment.id:
        segment.id = str(uuid.uuid4())
    segment.created_at = segment.created_at or _now()
    with _lock:
        path = _segment_path(segment.id)
        if path.exists():
            raise ValueError(f"segment {segment.id} already exists")
        _atomic_write(path, segment.model_dump_json(indent=2))
        idx = _read_index()
        idx[segment.id] = {
            "id": segment.id,
            "name": segment.name,
            "description": segment.description,
            "size": segment.size,
            "created_at": segment.created_at.isoformat(),
        }
        _atomic_write(INDEX_PATH, json.dumps(idx, ensure_ascii=False, indent=2))
    return segment


def get_segment(segment_id: str) -> Segment | None:
    # 파일 부재는 정상(존재하지 않는 id) → None.
    # 파일이 존재하는데 파싱/검증 실패는 데이터 손상이므로 삼키지 않고 로깅 후 재발생한다.
    # (손상을 '결과 없음'으로 둔갑시키면 운영자가 원인을 추적할 수 없다 — fail-fast)
    path = _segment_path(segment_id)
    if not path.exists():
        return None
    try:
        return Segment.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        logger.exception("세그먼트 손상/검증 실패: %s", segment_id)
        raise


def list_segments(limit: int = 100, offset: int = 0) -> tuple[list[dict], int]:
    """인덱스 기반 메타 목록 (persona_uuids 미포함)."""
    idx = _read_index()
    items = list(idx.values())
    items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    total = len(items)
    return items[offset : offset + limit], total


def delete_segment(segment_id: str) -> bool:
    path = _segment_path(segment_id)
    if not path.exists():
        return False
    with _lock:
        try:
            path.unlink()
        except OSError:
            return False
        idx = _read_index()
        if segment_id in idx:
            del idx[segment_id]
            _atomic_write(INDEX_PATH, json.dumps(idx, ensure_ascii=False, indent=2))
    return True
