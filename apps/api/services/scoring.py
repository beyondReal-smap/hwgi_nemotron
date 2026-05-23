"""반응도 스코어링 + 지역 집계.

알고리즘:
1) 룰 사전 필터 (age/sex/family_type) → 후보 인덱스
2) 후보가 너무 많으면 그대로, 너무 적으면(< 200) 룰 완화
3) 임베딩 코사인 유사도 top VECTOR_TOP_K (200) 추출
4) 점수 결합: 0.7 * cosine + 0.2 * rule_bonus + 0.1 * category_bonus
5) 0-100 정규화 → FINAL_TOP 반환
6) 시도/시군구 집계
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from models.schemas import (
    CohortStat,
    DemographicGroup,
    DistributionBin,
    PersonaHit,
    PopulationStats,
    RegionStat,
    SellingPoints,
)
from services.store import FilterParams, PersonaStore

# 단계별 후보 수
MIN_CANDIDATES = 200        # 룰 필터 통과 최소 (이하면 완화)
VECTOR_TOP_K = 200          # 코사인 후보 상위
DEFAULT_FINAL_TOP = 100      # 최종 후보 (top_k는 응답에서 슬라이스)
DEFAULT_BOTTOM_K = 100      # 하위 페르소나 수 (반대 반응 비교용)

# 점수 가중치
W_COSINE = 0.7
W_RULE = 0.2
W_CATEGORY = 0.1


def build_query_text(sp: SellingPoints) -> str:
    """소구점 → 임베딩 쿼리 텍스트."""
    parts = [sp.summary, *sp.key_benefits, *sp.target_keywords]
    return " ".join(p for p in parts if p)


def _build_filter(sp: SellingPoints) -> FilterParams:
    return FilterParams(
        age_min=sp.target_age_min,
        age_max=sp.target_age_max,
        sex=sp.target_sex or None,
        family_types=sp.target_family_types or None,
        education_levels=sp.target_education_levels or None,
        occupations=sp.target_occupations or None,
    )


def _rule_bonus(rows: pd.DataFrame, sp: SellingPoints) -> np.ndarray:
    """룰 보너스 (0-1). 명시된 타겟에 부합할수록 ↑.

    가중치 분배:
      연령 0.35 / 성별 0.15 / 가구형태 0.15 / 학력 0.15 / 직업 0.20
    한정이 없는 차원은 모든 페르소나에 만점 부여 (페널티 없음).
    """
    bonus = np.zeros(len(rows), dtype=np.float32)

    # 연령 (0.35)
    if sp.target_age_min is not None or sp.target_age_max is not None:
        lo = sp.target_age_min if sp.target_age_min is not None else 0
        hi = sp.target_age_max if sp.target_age_max is not None else 200
        bonus += np.where(
            (rows["age"].to_numpy() >= lo) & (rows["age"].to_numpy() <= hi),
            0.35, 0.0,
        )
    else:
        bonus += 0.35

    # 성별 (0.15)
    if sp.target_sex:
        bonus += np.where(rows["sex"].isin(sp.target_sex).to_numpy(), 0.15, 0.0)
    else:
        bonus += 0.15

    # 가구형태 (0.15)
    if sp.target_family_types:
        bonus += np.where(
            rows["family_type"].isin(sp.target_family_types).to_numpy(), 0.15, 0.0
        )
    else:
        bonus += 0.15

    # 교육 수준 (0.15)
    if sp.target_education_levels:
        bonus += np.where(
            rows["education_level"].isin(sp.target_education_levels).to_numpy(),
            0.15, 0.0,
        )
    else:
        bonus += 0.15

    # 직업 (0.20) — 부분 매칭
    if sp.target_occupations:
        pattern = "|".join(_re_escape_for_pandas(o) for o in sp.target_occupations)
        match = (
            rows["occupation"].fillna("").str.contains(pattern, regex=True, na=False)
        )
        bonus += np.where(match.to_numpy(), 0.20, 0.0)
    else:
        bonus += 0.20

    return bonus  # 0~1


def _re_escape_for_pandas(s: str) -> str:
    """pandas str.contains용 regex 이스케이프."""
    import re as _re
    return _re.escape(s)


_CATEGORY_TO_PERSONA_COL = {
    "professional": "professional_persona",
    "sports": "sports_persona",
    "arts": "arts_persona",
    "travel": "travel_persona",
    "culinary": "culinary_persona",
    "family": "family_persona",
}


def _category_bonus(rows: pd.DataFrame, sp: SellingPoints) -> np.ndarray:
    """카테고리 보너스 (0-1).

    MVP에서는 카테고리별 임베딩을 만들지 않았으므로,
    가중치가 높은 카테고리의 페르소나 텍스트가 비어있지 않은 경우 1.0,
    아니면 0.5의 평탄한 보너스를 부여 (사실상 가중치만 가산).

    추후 카테고리별 임베딩을 추가하면 여기서 카테고리 코사인 유사도 가중합으로 교체.
    """
    weights = sp.persona_category_weights or {}
    if not weights:
        return np.full(len(rows), 0.5, dtype=np.float32)

    # 가중치 합으로 정규화
    total_w = sum(weights.values()) or 1.0
    weighted = np.zeros(len(rows), dtype=np.float32)
    for cat, w in weights.items():
        col = _CATEGORY_TO_PERSONA_COL.get(cat)
        if not col or col not in rows.columns:
            continue
        non_empty = rows[col].fillna("").str.len() > 0
        weighted += (w / total_w) * non_empty.to_numpy(dtype=np.float32)

    return weighted  # 0~1


def _rows_to_personas(rows: pd.DataFrame) -> list[PersonaHit]:
    """DataFrame 행 → PersonaHit 리스트 변환 (상/하위 공용)."""
    return [
        PersonaHit(
            uuid=r["uuid"],
            score=float(r["score"]),
            persona=r["persona"],
            province=r["province"],
            district=r["district"],
            sex=r["sex"],
            age=int(r["age"]),
            occupation=r["occupation"],
            education_level=r.get("education_level"),
            family_type=r.get("family_type"),
            marital_status=r.get("marital_status"),
            military_status=r.get("military_status"),
        )
        for _, r in rows.iterrows()
    ]


def score_personas(
    sp: SellingPoints,
    query_vec: np.ndarray,
    store: PersonaStore,
    final_top: int = DEFAULT_FINAL_TOP,
    bottom_k: int = DEFAULT_BOTTOM_K,
) -> tuple[
    list[PersonaHit],
    list[PersonaHit],
    list[RegionStat],
    list[RegionStat],
    PopulationStats,
]:
    """100만 행 전체 스코어링 + 상위/하위 페르소나 + 지역 집계 + 모집단 통계.

    Returns:
        (top_personas, bottom_personas, province_stats, district_stats, population_stats)

    설계:
      1) score_all_personas로 전체 점수 + cohort 통계 산출
      2) 같은 점수 배열로 상위 final_top, 하위 bottom_k 인덱스 추출
      3) 상위 N명 기준으로 시도/시군구 집계
    """
    # 1) 전체 스코어링 + cohort 통계
    all_scores, population_stats = score_all_personas(sp, query_vec, store)

    if all_scores.max() == 0:
        return [], [], [], [], population_stats

    n = len(all_scores)

    # 2a) 상위 final_top 인덱스 (argpartition으로 빠르게)
    k_top = min(final_top, n)
    partial = np.argpartition(-all_scores, k_top - 1)[:k_top]
    top_idx = partial[np.argsort(-all_scores[partial])]

    top_rows = store.get_rows(top_idx).copy()
    top_rows["score"] = all_scores[top_idx]
    top_personas = _rows_to_personas(top_rows)

    # 2b) 하위 bottom_k 인덱스 (가장 점수 낮은 N명, 오름차순)
    k_bot = min(bottom_k, n)
    partial_b = np.argpartition(all_scores, k_bot - 1)[:k_bot]
    bottom_idx = partial_b[np.argsort(all_scores[partial_b])]

    bottom_rows = store.get_rows(bottom_idx).copy()
    bottom_rows["score"] = all_scores[bottom_idx]
    bottom_personas = _rows_to_personas(bottom_rows)

    # 3) 시도/시군구 집계 (상위 N명 기준 — 카드 화면용. 데이터는 보존 — RegionChart 제거 후에도 ScoreCard 1순위 등에 사용)
    province_stats = _aggregate_region(top_rows, "province")
    top_provinces = [p.name for p in province_stats[:3]]
    district_rows = top_rows[top_rows["province"].isin(top_provinces)]
    district_stats = _aggregate_region(district_rows, "district")

    return top_personas, bottom_personas, province_stats, district_stats, population_stats


# ============================================================
# 전체 100만 행 스코어링 + cohort 집계 (모집단 통계용)
# ============================================================

# percentile 기반 cohort 정의 — UI 라벨·임계값 한 곳에서 관리
_COHORT_SPECS = [
    ("core",     "핵심 타겟", 0.5),
    ("target",   "타겟층",    5.0),
    ("interest", "관심층",    20.0),
]

# Nemotron 카테고리형 컬럼별 표시 정책
# (컬럼명, UI 라벨, Top N — None이면 전체 카테고리 표시)
# 자유 텍스트 컬럼(persona, *_persona, skills/hobbies/career_goals)은 분포 불가라 제외.
_DEMOGRAPHIC_SPECS: list[tuple[str, str, int | None]] = [
    ("province",         "시도",          None),
    ("age_bucket",       "연령대",        None),   # 가상 컬럼 (실제 age로 계산)
    ("sex",              "성별",          None),
    ("marital_status",   "혼인 상태",     None),
    ("family_type",      "가구 유형",     10),
    ("housing_type",     "주거 형태",     None),
    ("education_level",  "교육 수준",     None),
    ("bachelors_field",  "학사 전공",     None),
    ("occupation",       "직업",          10),
    ("district",         "시군구",        20),
    ("military_status",  "병역",          None),
]


def score_all_personas(
    sp: SellingPoints,
    query_vec: np.ndarray,
    store: PersonaStore,
) -> tuple[np.ndarray, PopulationStats]:
    """100만 행 전체에 점수 계산 + cohort 통계 집계.

    Returns:
        (all_scores 0-100 (length=total), PopulationStats)

    참고: 후처리(get_rows 등)는 호출자가 score 인덱싱으로 수행.
    """
    df = store.df

    # 1) 코사인 (전체 100만)
    q_norm = np.linalg.norm(query_vec)
    if q_norm == 0:
        # 0 쿼리: 모든 점수 0
        all_scores = np.zeros(store.total, dtype=np.float32)
    else:
        q = (query_vec / q_norm).astype(np.float32)
        cosine_all = store.embeddings @ q  # (1m,) — L2 사전정규화 완료라 dot만
        cosine_norm = (cosine_all + 1.0) / 2.0

        # 2) 룰 보너스 (전체 100만)
        rule_all = _rule_bonus(df, sp)

        # 3) 카테고리 보너스 (전체 100만)
        cat_all = _category_bonus(df, sp)

        combined = W_COSINE * cosine_norm + W_RULE * rule_all + W_CATEGORY * cat_all
        all_scores = (combined * 100.0).clip(0, 100).astype(np.float32)

    # 4) cohort 분할 (percentile 기반)
    cohorts: list[CohortStat] = []
    cohort_indices: dict[str, np.ndarray] = {}
    for name, label, pct in _COHORT_SPECS:
        # 상위 pct% → 점수 임계값 (높을수록 적게 통과)
        threshold = float(np.percentile(all_scores, 100.0 - pct))
        mask = all_scores >= threshold
        idxs = np.where(mask)[0]
        cohort_indices[name] = idxs
        cohorts.append(
            CohortStat(
                name=name,
                label=label,
                percentile=pct,
                size=int(len(idxs)),
                min_score=threshold,
                avg_score=float(all_scores[idxs].mean()) if len(idxs) else 0.0,
            )
        )

    # 5) 분포 집계 (target cohort 모집단 기준)
    interest_idx = cohort_indices["interest"]
    target_idx = cohort_indices["target"]

    score_distribution = _score_histogram(all_scores[interest_idx])
    demographics = _build_demographics(df, target_idx)
    districts_full = _aggregate_districts_full(df, all_scores, target_idx)

    population = PopulationStats(
        total_scored=int(store.total),
        cohorts=cohorts,
        score_distribution=score_distribution,
        demographics=demographics,
        districts_full=districts_full,
    )
    return all_scores, population


def _aggregate_districts_full(
    df: pd.DataFrame, all_scores: np.ndarray, target_idx: np.ndarray
) -> list[RegionStat]:
    """타겟 cohort 기준 전국 시군구별 집계.

    name 형식: "시도-시군구" (예: "경기-광명시", "서울-서초구").
    지도 choropleth + Top N 표용. count 내림차순.

    score_personas의 _aggregate_region은 상위 50명 카드 기준이라 sparse하지만
    이쪽은 타겟층 5만 명이라 전국 거의 모든 시군구가 포함됨.
    """
    if len(target_idx) == 0:
        return []

    sub = df.iloc[target_idx][["province", "district", "uuid"]].copy()
    sub["score"] = all_scores[target_idx]
    # district 컬럼은 이미 "시도-시군구" 형식이라 그대로 사용. province를 또 prefix하면 중복.
    sub["region"] = sub["district"].astype(str)

    grouped = (
        sub.groupby("region")
        .agg(count=("uuid", "size"), avg_score=("score", "mean"))
        .reset_index()
    )
    top_uuids = (
        sub.sort_values("score", ascending=False)
        .groupby("region")["uuid"]
        .first()
        .to_dict()
    )
    grouped = grouped.sort_values("count", ascending=False)
    return [
        RegionStat(
            name=str(r["region"]),
            count=int(r["count"]),
            avg_score=float(r["avg_score"]),
            top_persona_uuid=top_uuids.get(r["region"]),
        )
        for _, r in grouped.iterrows()
    ]


def _build_demographics(
    df: pd.DataFrame, target_idx: np.ndarray
) -> list[DemographicGroup]:
    """Nemotron 카테고리형 컬럼별 분포를 _DEMOGRAPHIC_SPECS 순서로 생성."""
    if len(target_idx) == 0:
        return []

    groups: list[DemographicGroup] = []
    for column, label, top_n in _DEMOGRAPHIC_SPECS:
        if column == "age_bucket":
            bins = _age_buckets(df["age"], target_idx)
            groups.append(
                DemographicGroup(
                    column="age",
                    label=label,
                    bins=bins,
                    total_unique=len(bins),
                    truncated_to=None,
                )
            )
            continue

        if column not in df.columns:
            continue

        series = df[column].fillna("(미상)") if df[column].dtype == object else df[column]
        full_unique = int(series.iloc[target_idx].nunique())
        bins = _value_counts(series, target_idx, top_n=top_n)
        groups.append(
            DemographicGroup(
                column=column,
                label=label,
                bins=bins,
                total_unique=full_unique,
                truncated_to=top_n if (top_n is not None and full_unique > top_n) else None,
            )
        )
    return groups


def _score_histogram(scores: np.ndarray) -> list[DistributionBin]:
    """5점 단위 히스토그램 (점수 0~100)."""
    if len(scores) == 0:
        return []
    edges = np.arange(0, 105, 5)  # 0,5,10,...,100
    counts, _ = np.histogram(scores, bins=edges)
    bins: list[DistributionBin] = []
    for i, c in enumerate(counts):
        if c == 0 and edges[i] < 30:  # 0점대 초저득점 구간은 빈 막대 압축
            continue
        bins.append(DistributionBin(label=f"{edges[i]}~{edges[i+1]}", count=int(c)))
    return bins


def _value_counts(
    series: pd.Series, indices: np.ndarray, top_n: int | None
) -> list[DistributionBin]:
    """series.iloc[indices].value_counts() → DistributionBin 리스트."""
    if len(indices) == 0:
        return []
    counts = series.iloc[indices].value_counts()
    if top_n is not None:
        counts = counts.head(top_n)
    return [DistributionBin(label=str(k), count=int(v)) for k, v in counts.items()]


def _age_buckets(age_series: pd.Series, indices: np.ndarray) -> list[DistributionBin]:
    """20대 미만 / 20대 / 30대 / 40대 / 50대 / 60대 / 70대+ 버킷."""
    if len(indices) == 0:
        return []
    ages = age_series.iloc[indices].to_numpy()
    edges = [0, 20, 30, 40, 50, 60, 70, 200]
    labels = ["20세 미만", "20대", "30대", "40대", "50대", "60대", "70대+"]
    counts, _ = np.histogram(ages, bins=edges)
    return [
        DistributionBin(label=labels[i], count=int(c))
        for i, c in enumerate(counts)
        if c > 0
    ]


def _aggregate_region(rows: pd.DataFrame, col: str) -> list[RegionStat]:
    """시도/시군구별 집계: count, avg_score, top_persona_uuid."""
    if len(rows) == 0:
        return []
    grouped = (
        rows.groupby(col)
        .agg(count=("uuid", "size"), avg_score=("score", "mean"))
        .reset_index()
    )
    # top_persona_uuid: 각 그룹에서 점수 최고 uuid
    top_uuids = (
        rows.sort_values("score", ascending=False)
        .groupby(col)["uuid"]
        .first()
        .to_dict()
    )

    grouped = grouped.sort_values("count", ascending=False)
    return [
        RegionStat(
            name=str(r[col]),
            count=int(r["count"]),
            avg_score=float(r["avg_score"]),
            top_persona_uuid=top_uuids.get(r[col]),
        )
        for _, r in grouped.iterrows()
    ]
