"""교차 세그먼트 발굴 — 단변량 분포가 못 잡는 상호작용 조합을 lift 순으로 추출.

analyze.py에서 버려지던 cohort_indices(target)를 살려, 타겟 cohort가 전국 모집단
대비 '가장 진하게 몰린' 2~3개 인구통계 차원의 조합을 찾는다. 예: 단변량으로는
'40대 많음 / 유자녀 많음 / 경기 많음'까지만 보이지만, 교차하면 '40대 × 유자녀 ×
경기 3.4배 집중'이라는 마이크로 타겟이 드러난다. LLM·임베딩 0콜 (순수 pandas 집계).

성능:
- age_bucket 부여 work_df, 모집단 조합 빈도는 df 식별자 기준 모듈 캐시(첫 호출만 비용).
- target groupby는 ~5만 행이라 가볍다.
"""

from __future__ import annotations

import itertools

import numpy as np
import pandas as pd

from models.schemas import SegmentFinding
from services.store import PersonaStore

# 교차에 사용할 인구통계 차원 (자유 텍스트·고카디널리티 컬럼 제외)
_DIMENSIONS: tuple[str, ...] = (
    "age_bucket",       # 가상 컬럼 (age → 버킷)
    "sex",
    "family_type",
    "marital_status",
    "education_level",
    "province",
)

# 3차원 조합 — 의미 있는 핵심만 (전체 C(6,3)=20은 과다·해석난해)
_TRIPLES: tuple[tuple[str, str, str], ...] = (
    ("age_bucket", "family_type", "province"),
    ("age_bucket", "sex", "province"),
    ("sex", "family_type", "province"),
    ("age_bucket", "family_type", "marital_status"),
)

# 노이즈 컷 — 작은 조합은 lift가 과장돼 아티팩트가 된다.
_MIN_TARGET = 60        # 타겟 cohort 내 최소 인원
_MIN_POPULATION = 2000  # 전체 모집단 내 최소 인원(분모 안정)
_DEFAULT_TOP_N = 8

_AGE_EDGES = [0, 20, 30, 40, 50, 60, 70, 200]
_AGE_LABELS = ["20세 미만", "20대", "30대", "40대", "50대", "60대", "70대+"]

# df 식별자 기준 캐시 (store 수명주기 내 df 불변)
_WORK_DF_CACHE: dict[int, pd.DataFrame] = {}
_POP_COMBO_CACHE: dict[tuple, pd.Series] = {}


def _work_df(df: pd.DataFrame) -> pd.DataFrame:
    """차원 컬럼 + age_bucket만 담은 경량 작업 DF (groupby 키 전용). df별 1회 캐시."""
    key = id(df)
    cached = _WORK_DF_CACHE.get(key)
    if cached is None:
        cols = [d for d in _DIMENSIONS if d != "age_bucket" and d in df.columns]
        work = df[cols].copy()
        # _age_buckets(np.histogram, [lo,hi) 구간)와 동일 경계·라벨. right=False로 일치.
        work["age_bucket"] = pd.cut(
            df["age"], bins=_AGE_EDGES, labels=_AGE_LABELS, right=False
        )
        _WORK_DF_CACHE[key] = work
        cached = work
    return cached


def _population_combo_counts(work: pd.DataFrame, dims: tuple[str, ...]) -> pd.Series:
    """전체 모집단의 조합 빈도(MultiIndex Series). 조합별 1회 캐시."""
    key = (id(work), dims)
    cached = _POP_COMBO_CACHE.get(key)
    if cached is None:
        cached = work.groupby(list(dims), observed=True).size()
        _POP_COMBO_CACHE[key] = cached
    return cached


def _combo_key_to_dict(dims: tuple[str, ...], combo) -> dict[str, str]:
    """groupby 인덱스 키(스칼라 또는 튜플) → {차원: 값} dict."""
    if len(dims) == 1:
        return {dims[0]: str(combo)}
    return {d: str(v) for d, v in zip(dims, combo, strict=True)}


def discover_segments(
    store: PersonaStore,
    target_idx: np.ndarray,
    all_scores: np.ndarray,
    top_n: int = _DEFAULT_TOP_N,
) -> list[SegmentFinding]:
    """타겟 cohort 교차 세그먼트를 lift(전국 대비 집중도) 내림차순으로 top_n 반환.

    Args:
        store: 모집단 + df.
        target_idx: 타겟 cohort 반응자 인덱스(오름차순, np.where 산출).
        all_scores: 전체 100만 점수 배열 (조합 평균점수 계산용).
        top_n: 반환 세그먼트 수.

    노이즈 컷(_MIN_TARGET / _MIN_POPULATION)을 통과한 조합만 후보가 된다.
    조합 중복(같은 페르소나가 여러 조합에 등장)은 자연스럽다 — 서로 다른 관점의 마이크로 타겟.
    """
    target_total = int(target_idx.size)
    pop_total = int(store.total)
    if target_total == 0 or pop_total == 0:
        return []

    work = _work_df(store.df)
    dims_avail = [d for d in _DIMENSIONS if d in work.columns]

    # 2차원 전체 쌍 + 핵심 3차원
    combos: list[tuple[str, ...]] = list(itertools.combinations(dims_avail, 2))
    combos += [t for t in _TRIPLES if all(d in work.columns for d in t)]

    sub = work.iloc[target_idx].copy()
    sub["__score"] = all_scores[target_idx]

    findings: list[SegmentFinding] = []
    for dims in combos:
        grouped = sub.groupby(list(dims), observed=True)
        tgt_counts = grouped.size()
        tgt_scores = grouped["__score"].mean()
        pop_counts = _population_combo_counts(work, dims)

        for combo, t_count in tgt_counts.items():
            t_count = int(t_count)
            if t_count < _MIN_TARGET:
                continue
            try:
                p_count = int(pop_counts.get(combo, 0))
            except (TypeError, ValueError):
                p_count = 0
            if p_count < _MIN_POPULATION:
                continue
            share = t_count / target_total
            baseline_share = p_count / pop_total
            if baseline_share <= 0:
                continue
            lift = share / baseline_share
            dim_dict = _combo_key_to_dict(dims, combo)
            findings.append(
                SegmentFinding(
                    dimensions=dim_dict,
                    label=" · ".join(dim_dict.values()),
                    target_count=t_count,
                    population_count=p_count,
                    share=float(share),
                    baseline_share=float(baseline_share),
                    lift_ratio=float(lift),
                    avg_score=float(tgt_scores.get(combo, 0.0)),
                )
            )

    # lift 내림차순 → 동률이면 타겟 인원 큰 순(더 실용적인 큰 세그먼트 우선)
    findings.sort(key=lambda f: (f.lift_ratio, f.target_count), reverse=True)
    return findings[:top_n]
