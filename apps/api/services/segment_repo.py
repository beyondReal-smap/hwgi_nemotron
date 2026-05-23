"""세그먼트 영속화 — 저장된 페르소나 그룹.

디스크 레이아웃:
  data/segments/
    ├── _index.json              # {segment_id: meta}
    └── {segment_id}.json        # Segment 본체
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from models.survey import Segment

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
BASE_DIR = _PROJECT_ROOT / "data" / "segments"
INDEX_PATH = BASE_DIR / "_index.json"

_lock = threading.Lock()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _atomic_write(path: Path, content: str) -> None:
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


def _read_index() -> dict[str, dict]:
    if not INDEX_PATH.exists():
        return {}
    try:
        return json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


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
    path = _segment_path(segment_id)
    if not path.exists():
        return None
    try:
        return Segment.model_validate_json(path.read_text(encoding="utf-8"))
    except Exception:
        return None


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
