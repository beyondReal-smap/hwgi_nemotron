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
DEFAULT_FINAL_TOP = 30      # 상위 페르소나 수 (열렬 반응자)
DEFAULT_MID_K = 30          # 중위 페르소나 수 (median 근처 — 평균 시장 반응)
DEFAULT_BOTTOM_K = 30       # 하위 페르소나 수 (반대 반응자)

# ============================================================
# 하이브리드 점수 매핑 캘리브레이션 (v2_hybrid, 2026-05-29 확정)
# ============================================================
# 배경: 이전 v1은 cosine을 percentile-rank로 [0,1] 균등 매핑 → 모든 분석이 균등분포
#   U(20,90)가 되어 cohort 인원이 항상 71,429/214,286/357,143로 고정. cosine magnitude
#   (제품 매력도)를 100% 폐기하는 문제.
# v2: 분석 내 z-score(종형 안정화) + 글로벌 제품 오프셋(매력도 부분 반영) 하이브리드.
#   score = clip( z*SIGMA_T + (MU_BASE + BETA*(c_mean - MU_G))
#                 + W_RULE_PT*(rule-0.5) + W_CAT_PT*(cat-0.5), 0, 100 )
# 상수는 measure_cosine_dist.py(.archive/2026-05-29_scoring-cosine-measure/) 측정으로 확정.
#   - 제품별 cosine 평균 0.14~0.32 (range 0.18) >> 분석내 std ~0.03 → 변별력 충분
#   - BETA=100 시뮬레이션: 자동차 ≥65≈6.8만 vs 여행 ≈57만 (~8배), 극단 포화 없음
MU_G = 0.20        # 글로벌 cosine 중심 (제품평균들의 중앙)
MU_BASE = 55.0     # 평균적 제품(c_mean=MU_G)의 중심 점수
SIGMA_T = 11.0     # within 점수 spread (분석 간 분포 모양 일정)
BETA = 100.0       # 제품 매력도(c_mean - MU_G) 반영 강도
W_RULE_PT = 24.0   # rule 가산 보너스 스케일 (완전일치 +12, floor 0.1 → -9.6)
W_CAT_PT = 12.0    # cat 가산 보너스 스케일 (±6)
W_INSUR_PT = 4.0   # 보험 관심자(fin_interest_insurance) 가산 — 보험 반응도 분석 부스트 (통합 데이터 있을 때만)

SCORING_VERSION = "v2_hybrid"

# (구) v1 가중치 — 더 이상 점수 결합에 사용하지 않음. _rule_bonus/_category_bonus의
# 내부 차원 가중치(0.35/0.15/...)는 그대로 유지되며, 결합만 가산 보너스로 바뀜.
W_COSINE = 0.7
W_RULE = 0.2
W_CATEGORY = 0.1

# rule_bonus 정규화 하한값 (PR-2, Plan A 백테스트로 결정).
# 명시 차원만 분모로 정규화한 뒤 비일치자에게 적용되는 하한. 0이면 비일치자는
# cosine만으로 점수가 결정돼 분포 spread가 줄어듦. 0.1은 spread를 baseline 대비
# ~1.88배로 확장하면서 비일치자도 cosine 위주로 살아남게 하는 균형값.
# 검증: 5개 분석 10개 variant 평균 std 3.27→5.94, p99-p50 9.33→17.51 (변화율 +88%)
# top50 평균(76.61)·target 일치율(100%)·≥75 인원(1,979) 모두 보존됨.
RULE_BONUS_FLOOR = 0.1


# 보험 도메인 공통어 stop-list — query 임베딩이 보험 종사자(보험 관리자/사무원/상품 개발자)
# 의 페르소나 텍스트와 cosine 유사도를 비정상적으로 올리는 아티팩트 방지.
# 라이프스타일 단어(여성/출산/결혼 등)는 보존하여 의미는 유지.
# 적용 위치: query 텍스트 생성 시점. raw 점수 분포 영향(별도 트랙 Plan D 합의).
_QUERY_STOP_TOKENS = {
    "보험", "보험사", "보험상품", "보험료", "보험금",
    "보장", "진단", "진단비", "치료", "치료비",
    "가입", "만기", "환급", "약관", "면책",
    "원", "월", "만원", "천원",
    "상품", "설계", "컨셉",
}


def build_query_text(sp: SellingPoints) -> str:
    """소구점 → 임베딩 쿼리 텍스트.

    도메인 공통어(_QUERY_STOP_TOKENS)는 토큰 단위로 제거한다 — 그대로 두면
    "보험"이라는 단어 자체가 보험 종사자 직업 페르소나와 cosine 유사도를 끌어올려
    핵심 타겟에 보험 사무원·관리자가 반복 등장하는 아티팩트가 발생한다.
    """
    parts = [sp.summary, *sp.key_benefits, *sp.target_keywords]
    raw = " ".join(p for p in parts if p)
    if not raw:
        return raw
    tokens = [t for t in raw.split() if t not in _QUERY_STOP_TOKENS]
    return " ".join(tokens)


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
    """룰 보너스 (0-1) — 명시 차원만 분모로 정규화 + 하한값.

    PR-2 (Plan A 백테스트 후 확정) 방식. 이전(미명시 차원 만점 처리) 대비:
    - 분포 spread ~1.88배 확장 (std 3.27→5.94, p99-p50 9.33→17.51)
    - 상위 매칭 품질 100% 보존 (top50 평균·target 일치율·≥75 인원 동일)

    가중치 분배 (명시된 차원만 합산하여 분모로 사용):
      연령 0.35 / 성별 0.15 / 가구형태 0.15 / 학력 0.15 / 직업 0.20

    동작:
    - 명시 차원 0개 → 중립값 0.5 반환 (cosine·cat만으로 점수 결정)
    - 명시 차원 N개 → 일치=가중치 점유율, 비일치=0 → 합산 → RULE_BONUS_FLOOR 하한
    - 모든 차원 일치자: 1.0, 모든 차원 비일치자: floor(0.1)
    - 명시 차원이 많을수록 비일치자 페널티가 강해짐(타겟 정밀도 자연 보상)
    """
    n = len(rows)
    specified: list[tuple[float, np.ndarray]] = []  # (weight, match_array)

    # 연령 (0.35)
    if sp.target_age_min is not None or sp.target_age_max is not None:
        lo = sp.target_age_min if sp.target_age_min is not None else 0
        hi = sp.target_age_max if sp.target_age_max is not None else 200
        ages = rows["age"].to_numpy()
        m = ((ages >= lo) & (ages <= hi)).astype(np.float32)
        specified.append((0.35, m))

    # 성별 (0.15)
    if sp.target_sex:
        m = rows["sex"].isin(sp.target_sex).to_numpy().astype(np.float32)
        specified.append((0.15, m))

    # 가구형태 (0.15)
    if sp.target_family_types:
        m = rows["family_type"].isin(sp.target_family_types).to_numpy().astype(np.float32)
        specified.append((0.15, m))

    # 교육 수준 (0.15)
    if sp.target_education_levels:
        m = rows["education_level"].isin(sp.target_education_levels).to_numpy().astype(np.float32)
        specified.append((0.15, m))

    # 직업 (0.20) — 부분 매칭
    if sp.target_occupations:
        pattern = "|".join(_re_escape_for_pandas(o) for o in sp.target_occupations)
        match = (
            rows["occupation"].fillna("").str.contains(pattern, regex=True, na=False)
        ).to_numpy().astype(np.float32)
        specified.append((0.20, match))

    if not specified:
        # 타겟 차원이 전혀 명시되지 않음 → 중립 보너스 (cosine + cat가 점수 결정)
        return np.full(n, 0.5, dtype=np.float32)

    total_w = sum(w for w, _ in specified)
    bonus = np.zeros(n, dtype=np.float32)
    for w, match in specified:
        bonus += (w / total_w) * match
    return np.maximum(bonus, RULE_BONUS_FLOOR)  # 0~1, 비일치자도 floor 보장


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


def _compute_percentile_for_hits(
    hit_scores: np.ndarray, all_scores: np.ndarray
) -> np.ndarray:
    """상위 hit의 raw score를 모집단 백분위(0~100)로 변환.

    100만 행 전체 argsort 2회 대신 sort 1회 + searchsorted로 효율적.
    동률은 left/right 경계 평균(`rankdata(method='average')` 동치)으로
    동일 raw가 다른 percentile로 표시되는 부작용 방지. scipy 의존성 없음.
    """
    if len(hit_scores) == 0 or len(all_scores) == 0:
        return np.array([], dtype=np.float32)
    sorted_all = np.sort(all_scores)
    n = len(all_scores)
    left = np.searchsorted(sorted_all, hit_scores, side="left")
    right = np.searchsorted(sorted_all, hit_scores, side="right")
    avg_rank = (left + right) / 2.0  # 0~n
    # 백분위: 0=최하위, 100=최상위. avg_rank가 클수록(상위) 100에 가까움.
    return (avg_rank / n * 100.0).astype(np.float32)


def _rows_to_personas(
    rows: pd.DataFrame, percentiles: np.ndarray | None = None
) -> list[PersonaHit]:
    """DataFrame 행 → PersonaHit 리스트 변환 (상/하위 공용).

    percentiles: 각 행의 모집단 백분위 (없으면 percentile_score=None).
    """
    if percentiles is not None and len(percentiles) != len(rows):
        raise ValueError("percentiles length mismatch with rows")
    out: list[PersonaHit] = []
    for i, (_, r) in enumerate(rows.iterrows()):
        out.append(PersonaHit(
            uuid=r["uuid"],
            score=float(r["score"]),
            percentile_score=float(percentiles[i]) if percentiles is not None else None,
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
        ))
    return out


def score_personas(
    sp: SellingPoints,
    query_vec: np.ndarray,
    store: PersonaStore,
    final_top: int = DEFAULT_FINAL_TOP,
    mid_k: int = DEFAULT_MID_K,
    bottom_k: int = DEFAULT_BOTTOM_K,
) -> tuple[
    list[PersonaHit],
    list[PersonaHit],
    list[PersonaHit],
    list[RegionStat],
    list[RegionStat],
    PopulationStats,
]:
    """100만 행 전체 스코어링 + 상/중/하 페르소나 + 지역 집계 + 모집단 통계.

    Returns:
        (top_personas, mid_personas, bottom_personas, province_stats, district_stats, population_stats)

    설계:
      1) score_all_personas로 전체 점수 + cohort 통계 산출
      2) 같은 점수 배열로 상위 final_top, 중위 mid_k(median 근처 ±mid_k/2),
         하위 bottom_k 인덱스 추출
      3) 상위 N명 기준으로 시도/시군구 집계
    """
    # 1) 전체 스코어링 + cohort 통계
    all_scores, population_stats = score_all_personas(sp, query_vec, store)

    if all_scores.max() == 0:
        return [], [], [], [], [], population_stats

    n = len(all_scores)

    # 2a) 상위 final_top 인덱스 (argpartition으로 빠르게)
    k_top = min(final_top, n)
    partial = np.argpartition(-all_scores, k_top - 1)[:k_top]
    top_idx = partial[np.argsort(-all_scores[partial])]

    top_rows = store.get_rows(top_idx).copy()
    top_rows["score"] = all_scores[top_idx]
    top_pct = _compute_percentile_for_hits(all_scores[top_idx], all_scores)
    top_personas = _rows_to_personas(top_rows, percentiles=top_pct)

    # 2b) 하위 bottom_k 인덱스 (가장 점수 낮은 N명, 오름차순)
    k_bot = min(bottom_k, n)
    partial_b = np.argpartition(all_scores, k_bot - 1)[:k_bot]
    bottom_idx = partial_b[np.argsort(all_scores[partial_b])]

    bottom_rows = store.get_rows(bottom_idx).copy()
    bottom_rows["score"] = all_scores[bottom_idx]
    bottom_pct = _compute_percentile_for_hits(all_scores[bottom_idx], all_scores)
    bottom_personas = _rows_to_personas(bottom_rows, percentiles=bottom_pct)

    # 2c) 중위 mid_k 인덱스 (median 근처 ±mid_k/2 — 평균 시장 반응 샘플).
    # argpartition으로 median position 주변을 한 번에 추출. O(n)로 정렬 회피.
    k_mid = min(mid_k, n)
    if k_mid > 0:
        half = k_mid // 2
        mid_pos = n // 2
        lo = max(0, mid_pos - half)
        hi = min(n, lo + k_mid)
        # 점수 오름차순 기준 lo~hi 인덱스 = np.argpartition(scores, [lo, hi-1])
        # 양쪽 컷이 필요하므로 두 번 partition.
        if hi < n:
            scope = np.argpartition(all_scores, hi - 1)[:hi]
        else:
            scope = np.arange(n)
        if lo > 0:
            local = np.argpartition(all_scores[scope], lo)
            mid_idx_local = local[lo:hi]
        else:
            mid_idx_local = np.arange(len(scope))[:k_mid]
        mid_idx = scope[mid_idx_local]
        # 점수 내림차순 정렬해 표시 일관성 확보
        mid_idx = mid_idx[np.argsort(-all_scores[mid_idx])]

        mid_rows = store.get_rows(mid_idx).copy()
        mid_rows["score"] = all_scores[mid_idx]
        mid_pct = _compute_percentile_for_hits(all_scores[mid_idx], all_scores)
        mid_personas = _rows_to_personas(mid_rows, percentiles=mid_pct)
    else:
        mid_personas = []

    # 3) 시도/시군구 집계 (상위 N명 기준 — 카드 화면용).
    # 데이터는 보존 — RegionChart 제거 후에도 ScoreCard 1순위 등에 사용.
    province_stats = _aggregate_region(top_rows, "province")
    top_provinces = [p.name for p in province_stats[:3]]
    district_rows = top_rows[top_rows["province"].isin(top_provinces)]
    district_stats = _aggregate_region(district_rows, "district")

    return (
        top_personas,
        mid_personas,
        bottom_personas,
        province_stats,
        district_stats,
        population_stats,
    )


# ============================================================
# 전체 100만 행 스코어링 + cohort 집계 (모집단 통계용)
# ============================================================

# Cohort 정의 — 절대 점수 컷만 사용. percentile 폴백은 적용하지 않는다.
# (식별자, 라벨, 절대 점수 임계값, 참조용 percentile 표기)
#
# 임계값(85/75/65)은 cosine을 percentile rank로 [0,1] 균등 매핑한 뒤 결합식
# 0.7*cosine + 0.2*rule + 0.1*cat을 적용한 분포(μ≈48, σ≈20.6) 기준 합리화한 값:
# p99≈85, p90≈75, p74≈65에 해당하여 절대 컷이 분포 의미와 일치한다.
# percentile mapping은 batch별로 분포 모양이 일정(균등 σ=0.289)이라 임계값이
# 입력별로 출렁이지 않고 안정적으로 동작.
#
# 과거에는 인원 부족/과다 시 percentile 폴백을 적용했으나, 폴백이 들어가면
# raw 분포에서 ≥85인 인원이 그대로 노출되지 못하고 "상위 N% 폴백"으로 축소되어
# 모집단 분포 의미가 가려지는 문제가 있어 제거. 절대 컷만 적용한다.
# percentile 필드(두 번째 숫자)는 CohortStat.percentile로 그대로 전달되어
# 옛 분석 이력과 호환되는 라벨 참조용으로만 남는다.
_COHORT_SPECS: list[tuple[str, str, float, float]] = [
    ("core",     "핵심 타겟", 85.0, 0.5),
    ("target",   "타겟층",    75.0, 5.0),
    ("interest", "관심층",    65.0, 20.0),
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

        # 1) cosine → 점수 (하이브리드 v2): 분석 내 z-score(종형 안정화)
        #    + 글로벌 제품 오프셋(매력도 부분 반영). 상세는 상단 캘리브레이션 주석 참조.
        c_mean = float(cosine_all.mean())
        c_std = float(cosine_all.std())
        if c_std <= 0:
            c_std = 1e-6  # 모든 cosine 동일(degenerate) → z=0, center만 남음
        z = (cosine_all - c_mean) / c_std
        center = MU_BASE + BETA * (c_mean - MU_G)  # 제품 매력도 오프셋
        cosine_score = z * SIGMA_T + center        # clip 전 (rule/cat 가산 후 clip)

        # 2) 룰 보너스 (전체 100만, 0~1)
        rule_all = _rule_bonus(df, sp)

        # 3) 카테고리 보너스 (전체 100만, 0~1)
        cat_all = _category_bonus(df, sp)

        # 4) 보험 관심자 부스트 — AI Hub 통합 데이터(fin_) 있을 때만. 보험 반응도 분석에서
        #    실제 보험 관심층을 상위로 끌어올린다. 미통합 데이터셋에서는 0(영향 없음).
        insur = (
            df["fin_interest_insurance"].to_numpy(dtype=np.float32)
            if "fin_interest_insurance" in df.columns else np.float32(0.0)
        )

        # 5) 가산 보너스 결합 — 중립(0.5)이면 cosine_score 그대로 유지(spread 보존),
        #    타겟 일치자는 위로/비일치자는 아래로. (구 가중평균은 상수화 시 spread를 죽임)
        all_scores = np.clip(
            cosine_score
            + W_RULE_PT * (rule_all - 0.5)
            + W_CAT_PT * (cat_all - 0.5)
            + W_INSUR_PT * insur,
            0, 100,
        ).astype(np.float32)

    # 4) cohort 분할 — 절대 점수 컷만 적용. percentile 폴백 미사용.
    # abs_thr이 85→75→65로 단조 감소하므로 core ⊂ target ⊂ interest 위계가 자동 보장.
    cohorts: list[CohortStat] = []
    cohort_indices: dict[str, np.ndarray] = {}
    for name, label, abs_thr, pct in _COHORT_SPECS:
        mask_abs = all_scores >= abs_thr
        idxs = np.where(mask_abs)[0]

        cohort_indices[name] = idxs
        cohorts.append(
            CohortStat(
                name=name,
                label=label,
                percentile=pct,
                size=int(len(idxs)),
                min_score=abs_thr,
                avg_score=float(all_scores[idxs].mean()) if len(idxs) else 0.0,
                mode="absolute",
                threshold_absolute=abs_thr,
            )
        )

    # 5) 분포 집계
    # score_distribution: 전체 100만 명 분포 (코호트 컷오프 위치를 함께 보기 위함)
    # demographics/districts: 타겟 cohort 기준 (변동 없음)
    target_idx = cohort_indices["target"]

    score_distribution = _score_histogram(all_scores)
    demographics = _build_demographics(df, target_idx)
    districts_full = _aggregate_districts_full(df, all_scores, target_idx)

    # 6) raw 분포 통계 (PR-1) — 안 간 매력도 차이를 카드/비교표에서 노출하기 위한 메타.
    # raw score는 [52,78]로 좁아 cohort 인원만으로는 차이가 안 보임 → mean/std/p99 등 종합.
    raw_mean = float(all_scores.mean())
    raw_std = float(all_scores.std())
    raw_p50 = float(np.percentile(all_scores, 50))
    raw_p95 = float(np.percentile(all_scores, 95))
    raw_p99 = float(np.percentile(all_scores, 99))
    raw_max = float(all_scores.max())
    n_above_80 = int((all_scores >= 80).sum())  # UI/LLM '매우 높음' 컷
    n_above_65 = int((all_scores >= 65).sum())  # '높음' 컷

    core_idx = cohort_indices["core"]
    core_lift = (
        float(all_scores[core_idx].mean() - raw_mean) if len(core_idx) else 0.0
    )
    target_lift = (
        float(all_scores[target_idx].mean() - raw_mean) if len(target_idx) else 0.0
    )

    # 7) 품질 게이트 — 분포 비정상/cohort 의미 약화 자동 감지 (경고 배지용, 분석 차단 X)
    # 임계값은 1차 보수값. Plan C 캘리브레이션 후 조정 가능.
    quality_flags: list[str] = []
    # v2: z-score 매핑이라 spread(raw_p99-raw_p50)는 항상 일정 → 옛 '분포 좁음' 판정 무의미.
    # 대신 제품 매력도가 너무 낮아 핵심층(core)이 사실상 공허한 경우를 잡는다(라벨명 유지).
    core_size = int(len(cohort_indices["core"]))
    if core_size < 500:
        quality_flags.append("distribution_narrow")
    # core가 비면 lift 0 → 경고 정당. 종형 분포에서 정상 제품은 core lift가 크다.
    if core_lift < 1.0:
        quality_flags.append("core_low_lift")
    # cohort mode 혼재 — A/B 비교 부적합 시그널
    modes = {c.mode for c in cohorts}
    if len(modes) > 1:
        quality_flags.append("mode_inconsistent")

    population = PopulationStats(
        total_scored=int(store.total),
        cohorts=cohorts,
        score_distribution=score_distribution,
        demographics=demographics,
        districts_full=districts_full,
        raw_mean=raw_mean,
        raw_std=raw_std,
        raw_p50=raw_p50,
        raw_p95=raw_p95,
        raw_p99=raw_p99,
        raw_max=raw_max,
        n_above_80=n_above_80,
        n_above_65=n_above_65,
        core_lift=core_lift,
        target_lift=target_lift,
        quality_flags=quality_flags,
        scoring_version=SCORING_VERSION,
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
