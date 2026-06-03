"""OpenAI 임베딩 + 2계층 캐시 + per-key lock.

LLM provider(anthropic/sllm)와 무관하게 임베딩은 항상 OpenAI를 사용한다.
"""

from __future__ import annotations

import threading
import weakref

import numpy as np
from tenacity import retry, stop_after_attempt, wait_exponential

from services import embed_cache

from .clients import openai_client
from .config import EMBED_MODEL


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def _embed_text_uncached(text: str) -> np.ndarray:
    """OpenAI 임베딩 API 직접 호출 (캐시 미적용)."""
    res = openai_client().embeddings.create(model=EMBED_MODEL, input=[text])
    return np.asarray(res.data[0].embedding, dtype=np.float32)


# per-key lock — 동일 query 동시 miss 시 OpenAI 중복 호출 방지.
# WeakValueDictionary로 미사용 lock은 자동 GC → 무한 증가 없음.
_embed_key_locks: weakref.WeakValueDictionary[str, threading.Lock] = (
    weakref.WeakValueDictionary()
)
_embed_keys_guard = threading.Lock()


def _get_embed_lock(key: str) -> threading.Lock:
    """key별 lock 획득. dict 자체는 약참조라 호출자가 strong ref 유지 필요."""
    with _embed_keys_guard:
        lock = _embed_key_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _embed_key_locks[key] = lock
        return lock


def embed_text(text: str) -> list[float]:
    """text → 1536d 임베딩. (model, text) 단위 영속 캐시 적용.

    캐시 hit 시 OpenAI 호출 0회 (200~500ms 절감).
    동일 query 동시 miss 시 per-key lock으로 OpenAI 중복 호출 방지.
    리턴 타입은 호환성 위해 list[float] 유지 — 호출자가 np.array로 변환.
    """
    key = embed_cache.cache_key(EMBED_MODEL, text)
    # 1차 조회 — fast path (hit 시 lock 획득 안 함)
    cached = embed_cache.get(key)
    if cached is not None:
        return cached.tolist()

    # 동시 miss 직렬화 — 같은 key는 한 번만 OpenAI 호출
    per_key_lock = _get_embed_lock(key)
    with per_key_lock:
        # double-check: lock 대기 중 다른 요청이 채웠을 수 있음
        cached = embed_cache.get(key)
        if cached is not None:
            return cached.tolist()
        arr = _embed_text_uncached(text)
        embed_cache.put(key, arr)
        return arr.tolist()
