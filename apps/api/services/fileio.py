"""파일 기반 영속화 공통 I/O.

분석/AB/설문/세그먼트 저장소가 공유하던 동일 코드를 한곳으로 모은다.

- JSONL append-only: analyses/abtests/simulations (단일 파일 로그)
  · append_jsonl  — id+created_at 부여 후 1줄 추가
  · read_jsonl    — 전체 스캔(손상 줄 skip)
  · rewrite_jsonl — 전체 atomic 재작성(삭제/truncate용)
- atomic 텍스트 쓰기: surveys/segments (디렉토리 기반 JSON)
  · atomic_write_text — tmp → fsync → rename (부분 쓰기 방지)
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import uuid
from datetime import UTC, datetime
from pathlib import Path

# JSONL 쓰기 직렬화 락 — uvicorn 스레드풀(sync 핸들러)에서 append/rewrite가 동시에
# 실행되면 read-modify-write race로 방금 append된 레코드가 유실되거나 라인 경계가
# 깨질 수 있다. path별 락으로 append와 rewrite를 상호배제한다.
# (--workers 1이라 프로세스 간 동시성은 없고 스레드 간만 유효)
_locks_guard = threading.Lock()
_path_locks: dict[str, threading.Lock] = {}


def _lock_for(path: Path) -> threading.Lock:
    """path(절대경로 문자열) 단위 락 반환. append와 rewrite가 같은 락을 공유해야 한다."""
    key = str(path.resolve())
    with _locks_guard:
        lock = _path_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _path_locks[key] = lock
    return lock


def append_jsonl(path: Path, payload: dict, *, id_key: str = "id") -> str:
    """payload에 새 uuid(id_key)와 created_at(UTC)을 부여해 1줄 append. 생성된 id 반환."""
    path.parent.mkdir(parents=True, exist_ok=True)
    record_id = str(uuid.uuid4())
    record = {
        id_key: record_id,
        "created_at": datetime.now(UTC).isoformat(),
        **payload,
    }
    with _lock_for(path), path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    return record_id


def read_jsonl(path: Path) -> list[dict]:
    """전체 레코드를 list로 반환. 파일이 없으면 [], 손상된 줄은 건너뛴다(운영 안정성)."""
    if not path.exists():
        return []
    records: list[dict] = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return records


def rewrite_jsonl(path: Path, records: list[dict]) -> None:
    """파일 전체를 records로 재작성 (tmp 파일 작성 후 rename — atomic).

    append_jsonl과 같은 path 락을 공유해, 삭제(rewrite)와 저장(append)이 겹쳐
    방금 append된 레코드가 유실되는 것을 방지한다.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with _lock_for(path):
        with tmp.open("w", encoding="utf-8") as f:
            for r in records:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        tmp.replace(path)


def atomic_write_text(path: Path, content: str) -> None:
    """tmp 파일 → fsync → rename. 부분 쓰기/동시 읽기 손상을 방지한다."""
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
