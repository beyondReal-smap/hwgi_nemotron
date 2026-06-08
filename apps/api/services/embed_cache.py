"""쿼리 임베딩 캐시 — (model, text) 단위.

목적:
  - 동일 쿼리 임베딩 재호출 시 OpenAI API 호출 0회 (200~500ms 절감)
  - 서버 재시작에도 영속 (디스크 캐시)
  - 동일 약관 재분석·동일 자연어 검색 시 체감 속도 ↑

디스크 레이아웃:
  data/embed_cache/
    └── {sha256[:2]}/{sha256}.npy    # 1024d float32 array (≈4KB/건)

캐시 키:
  sha256(model + "|" + text)
  - model은 EMBED_MODEL 변경 시 자동 무효화되도록 키에 포함
  - text는 임베딩 호출에 들어가는 그대로 (호출자에서 정규화 책임)

계층:
  1) 인메모리 LRU (4096개 ≈ 24MB) — 첫 hit
  2) 디스크 .npy — 영속, 재시작 보존
  3) miss 시 OpenAI 호출 → 양쪽 채움

Retention:
  - cleanup_old(max_age_days, max_entries)로 mtime 기반 정리
  - get() 시 디스크 hit이면 mtime touch → 자주 쓰이는 hot 캐시 보호
  - 기본 정책은 main.py startup에서 환경변수로 적용
"""

from __future__ import annotations

import hashlib
import os
import tempfile
import threading
from collections import OrderedDict
from pathlib import Path

import numpy as np

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
BASE_DIR = _PROJECT_ROOT / "data" / "embed_cache"

# 인메모리 LRU 한도 — 1024d float32 × 4096 ≈ 16MB
_MEM_LIMIT = 4096
_mem_cache: OrderedDict[str, np.ndarray] = OrderedDict()
_lock = threading.Lock()


def cache_key(model: str, text: str) -> str:
    """동일 (model, text) 조합은 동일 키. text는 호출자에서 정규화 후 전달."""
    raw = f"{model}|{text}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _path(key: str) -> Path:
    """샤딩: 첫 2자를 디렉토리로 → 한 디렉토리에 너무 많은 파일 안 쌓이도록."""
    return BASE_DIR / key[:2] / f"{key}.npy"


def _promote(key: str, arr: np.ndarray) -> None:
    """LRU 갱신 — lock 보유 상태에서 호출."""
    _mem_cache[key] = arr
    _mem_cache.move_to_end(key)
    while len(_mem_cache) > _MEM_LIMIT:
        _mem_cache.popitem(last=False)


def get(key: str) -> np.ndarray | None:
    """캐시 조회 — 메모리 → 디스크 순. miss면 None.

    디스크 hit 시 mtime을 touch하여 retention(cleanup_old)에서 잘못 삭제되지
    않도록 한다 — 자주 쓰이는 hot 캐시 보호.
    """
    # 1) 메모리 hit
    with _lock:
        if key in _mem_cache:
            _mem_cache.move_to_end(key)
            return _mem_cache[key]

    # 2) 디스크 hit
    p = _path(key)
    if not p.exists():
        return None
    try:
        arr = np.load(p)
    except Exception:
        # 캐시 손상 시 무시 (재호출로 회복)
        return None

    # mtime touch — retention 정책에서 hot 캐시 보호
    try:
        os.utime(p, None)
    except OSError:
        pass  # touch 실패는 무시 (캐시 동작에 영향 없음)

    # 메모리에 promote
    with _lock:
        _promote(key, arr)
    return arr


def put(key: str, arr: np.ndarray) -> None:
    """캐시 저장 — 메모리 + 디스크 atomic write.

    디스크 IO는 OS가 atomic write(mkstemp + os.replace)를 보장하므로
    별도 락 없이 동시 호출 안전. 메모리 LRU 갱신만 락으로 보호.
    """
    # 1) 메모리 (LRU 순서 갱신은 락 보호 필요)
    with _lock:
        _promote(key, arr)

    # 2) 디스크 (atomic — 락 불필요)
    p = _path(key)
    p.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(p.parent), prefix=".tmp_", suffix=".npy")
    try:
        with os.fdopen(fd, "wb") as f:
            np.save(f, arr)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, p)
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def stats() -> dict:
    """캐시 사용량 + 가장 오래된/최신 파일 경과 시간 (디버그·관측용)."""
    import time as _time

    file_count = 0
    size = 0
    oldest_mtime: float | None = None
    newest_mtime: float | None = None
    if BASE_DIR.exists():
        for shard in BASE_DIR.iterdir():
            if not shard.is_dir():
                continue
            for f in shard.glob("*.npy"):
                file_count += 1
                try:
                    st = f.stat()
                    size += st.st_size
                    if oldest_mtime is None or st.st_mtime < oldest_mtime:
                        oldest_mtime = st.st_mtime
                    if newest_mtime is None or st.st_mtime > newest_mtime:
                        newest_mtime = st.st_mtime
                except OSError:
                    pass
    now = _time.time()
    return {
        "disk_file_count": file_count,
        "disk_bytes": size,
        "mem_count": len(_mem_cache),
        "mem_limit": _MEM_LIMIT,
        "oldest_age_days": round((now - oldest_mtime) / 86400.0, 2) if oldest_mtime else None,
        "newest_age_days": round((now - newest_mtime) / 86400.0, 2) if newest_mtime else None,
    }


def cleanup_old(
    max_age_days: int | None = 30,
    max_entries: int | None = 50_000,
) -> dict:
    """오래된·초과 캐시 파일 정리. mtime 기준 (get() 시 touch됨).

    Args:
        max_age_days: 마지막 수정/접근 후 N일 지난 파일 삭제. None/0 이하면 미적용.
        max_entries: 전체 파일 수가 N을 초과하면 oldest mtime부터 삭제. None/0 이하면 미적용.

    Returns:
        {scanned, deleted_age, deleted_overflow, freed_bytes, kept}
    """
    import time as _time

    if not BASE_DIR.exists():
        return {
            "scanned": 0, "deleted_age": 0, "deleted_overflow": 0,
            "freed_bytes": 0, "kept": 0,
        }

    age_seconds = (max_age_days * 86400) if max_age_days and max_age_days > 0 else None
    cap = max_entries if max_entries and max_entries > 0 else None
    now = _time.time()

    # 1) 모든 파일 수집 (path, mtime, size)
    files: list[tuple[Path, float, int]] = []
    for shard in BASE_DIR.iterdir():
        if not shard.is_dir():
            continue
        for f in shard.glob("*.npy"):
            try:
                st = f.stat()
                files.append((f, st.st_mtime, st.st_size))
            except OSError:
                continue

    scanned = len(files)
    deleted_age = 0
    deleted_overflow = 0
    freed_bytes = 0

    # 2) 나이 기준 청소
    if age_seconds is not None:
        threshold = now - age_seconds
        survivors: list[tuple[Path, float, int]] = []
        for f, mtime, size in files:
            if mtime < threshold:
                try:
                    f.unlink()
                    deleted_age += 1
                    freed_bytes += size
                except OSError:
                    survivors.append((f, mtime, size))
            else:
                survivors.append((f, mtime, size))
        files = survivors

    # 3) 개수 기준 청소 (oldest 우선)
    if cap is not None and len(files) > cap:
        files.sort(key=lambda x: x[1])  # mtime 오름차순
        overflow_count = len(files) - cap
        for f, _, size in files[:overflow_count]:
            try:
                f.unlink()
                deleted_overflow += 1
                freed_bytes += size
            except OSError:
                pass
        files = files[overflow_count:]

    return {
        "scanned": scanned,
        "deleted_age": deleted_age,
        "deleted_overflow": deleted_overflow,
        "freed_bytes": freed_bytes,
        "kept": len(files),
    }
