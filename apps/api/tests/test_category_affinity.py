"""카테고리 개념벡터 친화도 보너스 회귀 테스트.

버그(2026-06-08): _category_bonus가 'persona 텍스트 비어있지 않으면 1.0'(non_empty
마스크)을 신호로 썼는데 100만 페르소나 전원이 6개 카테고리 텍스트를 100% 채워 cat_all이
상수 1.0 → 가중치를 바꿔도 점수·코호트·분포가 불변(What-if 무반응).
수정: persona 임베딩 × 6개 카테고리 개념벡터 코사인을 카테고리별 백분위 정규화한 친화도
행렬을 가중평균 → 가중치가 실제 변별에 반영.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import services.scoring as scoring
from models.schemas import SellingPoints
from services.scoring import (
    _CATEGORY_ORDER,
    _category_affinity_matrix,
    _category_bonus,
)


class _FakeStore:
    """_category_affinity_matrix/_category_bonus가 쓰는 최소 인터페이스."""

    def __init__(self, embeddings: np.ndarray) -> None:
        self.embeddings = embeddings

    @property
    def total(self) -> int:
        return len(self.embeddings)


def _fake_embed_factory():
    """개념 문장 → 해당 카테고리 축의 단위벡터(직교)로 매핑하는 embed_text 대체."""
    text_to_idx = {scoring._CATEGORY_CONCEPT_TEXT[c]: i for i, c in enumerate(_CATEGORY_ORDER)}

    def _fake_embed(text: str) -> list[float]:
        vec = np.zeros(len(_CATEGORY_ORDER), dtype=np.float32)
        vec[text_to_idx[text]] = 1.0
        return vec.tolist()

    return _fake_embed


def _make_store(n: int = 4000, seed: int = 7) -> _FakeStore:
    rng = np.random.default_rng(seed)
    emb = rng.standard_normal((n, len(_CATEGORY_ORDER))).astype(np.float32)
    emb /= np.linalg.norm(emb, axis=1, keepdims=True)  # 단위 정규화(persona 임베딩 모사)
    return _FakeStore(emb)


def _sp(weights: dict[str, float]) -> SellingPoints:
    return SellingPoints(summary="테스트", persona_category_weights=weights)


def test_affinity_matrix_percentile_normalized(monkeypatch) -> None:
    monkeypatch.setattr(scoring, "embed_text", _fake_embed_factory())
    store = _make_store()
    aff = _category_affinity_matrix(store)

    assert aff.shape == (store.total, len(_CATEGORY_ORDER))
    # 백분위 정규화 → 각 컬럼 평균 0.5, 범위 (0,1)
    assert np.allclose(aff.mean(axis=0), 0.5, atol=1e-4)
    assert aff.min() > 0.0 and aff.max() < 1.0
    # 캐시 동작: 2회차는 동일 객체 반환
    assert _category_affinity_matrix(store) is aff


def test_weights_change_bonus(monkeypatch) -> None:
    """단일 가중치만 바꿔도 cat_all이 달라진다(버그의 핵심 증상 = 불변)."""
    monkeypatch.setattr(scoring, "embed_text", _fake_embed_factory())
    store = _make_store()
    rows = store.embeddings  # len == total (DataFrame 대신 길이만 사용)

    travel = _category_bonus(rows, _sp({"travel": 1.0}), store)
    family = _category_bonus(rows, _sp({"family": 1.0}), store)
    # 서로 다른 카테고리 가중치 → 서로 다른 보너스 분포
    assert not np.allclose(travel, family)

    # travel 가중치만 0.5→1.0으로 올려도(다른 값 고정) 결과가 바뀌어야 한다.
    base = _category_bonus(rows, _sp({"travel": 0.5, "family": 0.5}), store)
    more_travel = _category_bonus(rows, _sp({"travel": 1.0, "family": 0.5}), store)
    assert not np.allclose(base, more_travel)


def test_bonus_is_zero_mean_redistribution(monkeypatch) -> None:
    """어떤 가중치 조합이든 cat_all 평균은 ≈0.5 (모집단 평균 영향 0, 순위만 재분배)."""
    monkeypatch.setattr(scoring, "embed_text", _fake_embed_factory())
    store = _make_store()
    rows = store.embeddings
    for w in ({"travel": 1.0}, {"travel": 0.8, "family": 0.2},
              {c: 1.0 for c in _CATEGORY_ORDER}):
        cat = _category_bonus(rows, _sp(w), store)
        assert abs(float(cat.mean()) - 0.5) < 1e-3, w


def test_weight_lifts_aligned_personas(monkeypatch) -> None:
    """travel 가중 시 travel 축(인덱스 3) 성향이 강한 페르소나가 상위로."""
    monkeypatch.setattr(scoring, "embed_text", _fake_embed_factory())
    store = _make_store()
    rows = store.embeddings
    j_travel = _CATEGORY_ORDER.index("travel")

    cat = _category_bonus(rows, _sp({"travel": 1.0}), store)
    top = np.argsort(-cat)[:200]  # 보너스 상위 200명
    # 상위 200명의 travel 임베딩 성분 평균 > 전체 평균
    assert store.embeddings[top, j_travel].mean() > store.embeddings[:, j_travel].mean()


def test_no_weights_returns_neutral(monkeypatch) -> None:
    monkeypatch.setattr(scoring, "embed_text", _fake_embed_factory())
    store = _make_store()
    rows = store.embeddings
    cat = _category_bonus(rows, _sp({}), store)
    assert np.all(cat == 0.5)
