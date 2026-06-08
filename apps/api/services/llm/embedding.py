"""KURE-v1 로컬 임베딩(in-process) + 2계층 캐시 + per-key lock.

LLM provider(anthropic/sllm/openai)와 무관하게 임베딩은 KURE-v1(BAAI/bge-m3 한국어
파인튜닝, 1024d)을 로컬 GPU로 추론한다. 모델은 lazy singleton으로 1회만 로드(약 28초).
"""

from __future__ import annotations

import threading
import weakref

import numpy as np

from services import embed_cache

from .config import EMBED_DEVICE, EMBED_MAX_SEQ, EMBED_MODEL

# KURE 모델 lazy singleton — 첫 임베딩 요청 시 1회 로드(GPU ~28초), 이후 재사용.
_kure_model = None
_kure_model_lock = threading.Lock()


def _get_kure_model():
    """KURE-v1 SentenceTransformer 인스턴스(lazy, thread-safe singleton).

    무거운 의존성(torch/sentence_transformers)은 함수 내부 import로 지연 — 임베딩을
    쓰지 않는 코드 경로(테스트·스크립트)가 GPU 스택을 강제로 로드하지 않도록.
    """
    global _kure_model
    if _kure_model is not None:
        return _kure_model
    with _kure_model_lock:
        if _kure_model is None:
            import torch
            from sentence_transformers import SentenceTransformer

            device = EMBED_DEVICE or ("cuda" if torch.cuda.is_available() else "cpu")
            dtype = torch.float16 if device.startswith("cuda") else torch.float32
            model = SentenceTransformer(
                EMBED_MODEL, device=device, model_kwargs={"torch_dtype": dtype}
            )
            model.max_seq_length = EMBED_MAX_SEQ
            _kure_model = model
    return _kure_model


def preload_embedder() -> None:
    """앱 startup에서 호출해 첫 요청 지연(모델 로드 ~28초)을 사전 흡수."""
    _get_kure_model()


def _embed_text_uncached(text: str) -> np.ndarray:
    """KURE-v1 로컬 인코딩 (캐시 미적용). normalize_embeddings로 L2 정규화 → dot=cosine.

    로컬 추론이라 네트워크 재시도는 무의미 — GPU 오류/OOM은 fail-fast로 표면화한다.
    """
    model = _get_kure_model()
    emb = model.encode([text], normalize_embeddings=True, convert_to_numpy=True)
    return np.asarray(emb[0], dtype=np.float32)


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
    """text → 1024d 임베딩(KURE-v1). (model, text) 단위 영속 캐시 적용.

    캐시 hit 시 GPU 추론 0회. EMBED_MODEL이 키에 포함돼 모델 교체 시 캐시 자동 무효화.
    동일 query 동시 miss 시 per-key lock으로 중복 추론 방지.
    리턴 타입은 호환성 위해 list[float] 유지 — 호출자가 np.array로 변환.
    """
    key = embed_cache.cache_key(EMBED_MODEL, text)
    # 1차 조회 — fast path (hit 시 lock 획득 안 함)
    cached = embed_cache.get(key)
    if cached is not None:
        return cached.tolist()

    # 동시 miss 직렬화 — 같은 key는 한 번만 GPU 추론
    per_key_lock = _get_embed_lock(key)
    with per_key_lock:
        # double-check: lock 대기 중 다른 요청이 채웠을 수 있음
        cached = embed_cache.get(key)
        if cached is not None:
            return cached.tolist()
        arr = _embed_text_uncached(text)
        embed_cache.put(key, arr)
        return arr.tolist()
