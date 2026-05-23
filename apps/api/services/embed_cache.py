"""쿼리 임베딩 캐시 — (model, text) 단위.

목적:
  - 동일 쿼리 임베딩 재호출 시 OpenAI API 호출 0회 (200~500ms 절감)
  - 서버 재시작에도 영속 (디스크 캐시)
  - 동일 약관 재분석·동일 자연어 검색 시 체감 속도 ↑

디스크 레이아웃:
  data/embed_cache/
    └── {sha256[:2]}/{sha256}.npy    # 1536d float32 array (≈6KB/건)

캐시 키:
  sha256(model + "|" + text)
  - model은 EMBED_MODEL 변경 시 자동 무효화되도록 키에 포함
  - text는 임베딩 호출에 들어가는 그대로 (호출자에서 정규화 책임)

계층:
  1) 인메모리 LRU (4096개 ≈ 24MB) — 첫 hit
  2) 디스크 .npy — 영속, 재시작 보존
  3) miss 시 OpenAI 호출 → 양쪽 채움
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

# 인메모리 LRU 한도 — 1536d float32 × 4096 ≈ 24MB
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
    """캐시 조회 — 메모리 → 디스크 순. miss면 None."""
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
    """캐시 사용량 (디버그·관측용)."""
    file_count = 0
    size = 0
    if BASE_DIR.exists():
        for shard in BASE_DIR.iterdir():
            if not shard.is_dir():
                continue
            for f in shard.glob("*.npy"):
                file_count += 1
                try:
                    size += f.stat().st_size
                except OSError:
                    pass
    return {
        "disk_file_count": file_count,
        "disk_bytes": size,
        "mem_count": len(_mem_cache),
        "mem_limit": _MEM_LIMIT,
    }
