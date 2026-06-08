"""N개 안(案)의 반응 코호트 겹침 행렬 — 잠식(Cannibalization) 분석 코어.

각 안을 100만 페르소나에 스코어링해 얻은 반응자 인덱스 집합(cohort_indices)을
서버 메모리 내부에서만 교집합/합집합 연산하고, N×N 스칼라 행렬만 산출한다.
인덱스 배열 자체는 외부로 노출하지 않는다(score_all_personas에서 회수 → 여기서 소비).

겹침은 임베딩 의미 유사도 기반이므로 실제 구매 잠식이 아니라 '반응 겹침(swing 가능층)'
수준의 신호다. 호출자는 이 한계를 UI 면책/경고로 반드시 전달해야 한다.
"""

from __future__ import annotations

import numpy as np

from models.schemas import SellingPoints
from services.scoring import score_all_personas
from services.store import PersonaStore

# 겹침 산출 기준 코호트 레벨 → score_all_personas cohort_indices 키
_COHORT_KEY: dict[str, str] = {"core": "core", "target": "target", "interest": "interest"}

# 이 인원 미만 코호트는 소표본 노이즈 위험 → 경고(small_cohort)
SMALL_COHORT_MIN = 500


def score_item_cohort(
    sp: SellingPoints,
    query_vec: np.ndarray,
    store: PersonaStore,
    level: str,
) -> np.ndarray:
    """한 안의 반응자 인덱스 배열만 추출(상/중/하 페르소나·지역 집계 등 무거운 후처리 우회).

    score_all_personas는 cohort_indices를 이미 산출하므로 추가 LLM·임베딩 호출이 없다.
    반환 배열은 np.where 산출이라 오름차순·유일성이 보장된다(intersect1d assume_unique 가능).
    """
    key = _COHORT_KEY.get(level)
    if key is None:
        raise ValueError(f"알 수 없는 cohort_level: {level!r} (core|target|interest)")
    _scores, _pop, cohort_indices = score_all_personas(sp, query_vec, store)
    return cohort_indices[key]


def build_overlap_matrices(
    cohorts: list[np.ndarray],
) -> tuple[list[list[float]], list[list[float]], list[int]]:
    """안별 반응자 인덱스 집합으로 N×N 겹침 행렬 2종 산출.

    Args:
        cohorts: 안별 반응자 인덱스 배열(오름차순·유일, np.where 산출).

    Returns:
        (directional, jaccard, sizes)
        - directional[i][j] = |Ci ∩ Cj| / |Ci|       (i안 반응자 중 j안에도 반응한 비율, 비대칭)
        - jaccard[i][j]     = |Ci ∩ Cj| / |Ci ∪ Cj|  (대칭)
        - sizes[i]          = |Ci|
        대각선(i==j)은 1.0. 분모가 0이면 0.0.
    """
    n = len(cohorts)
    sizes = [int(c.size) for c in cohorts]
    directional = [[0.0] * n for _ in range(n)]
    jaccard = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            if i == j:
                directional[i][j] = 1.0
                jaccard[i][j] = 1.0
                continue
            inter = int(
                np.intersect1d(cohorts[i], cohorts[j], assume_unique=True).size
            )
            si = sizes[i]
            directional[i][j] = inter / si if si else 0.0
            union = sizes[i] + sizes[j] - inter
            jaccard[i][j] = inter / union if union else 0.0
    return directional, jaccard, sizes


def compute_coverage(cohorts: list[np.ndarray]) -> list[tuple[int, int, int]]:
    """greedy union 누적 — 가장 큰 코호트부터, 이후 marginal lift(신규 도달) 최대 순.

    "안을 몇 개, 어떤 순서로 내야 충분한가"의 라인업 곡선.
    Returns: [(item_index, marginal_new, cumulative_total), ...] 라인업 순서대로.
    """
    n = len(cohorts)
    remaining = set(range(n))
    covered = np.array([], dtype=np.int64)
    steps: list[tuple[int, int, int]] = []
    while remaining:
        best_i, best_new, best_union = -1, -1, covered
        for i in remaining:
            u = np.union1d(covered, cohorts[i])
            new = int(u.size - covered.size)
            if new > best_new:
                best_i, best_new, best_union = i, new, u
        covered = best_union
        steps.append((best_i, best_new, int(covered.size)))
        remaining.discard(best_i)
    return steps


def compute_multiplicity(cohorts: list[np.ndarray]) -> list[tuple[int, int]]:
    """각 페르소나가 몇 개 안의 반응층에 속하나 → 다중도별 인원(노출 중복도).

    concatenate → bincount(소속 안 개수) → bincount(다중도 히스토그램).
    Returns: [(overlap_count, persona_count), ...] (1,2,...,N 중 인원>0인 것만).
    """
    if not cohorts:
        return []
    allcat = np.concatenate(cohorts)
    counts = np.bincount(allcat)        # persona_idx -> 소속 안 개수
    membership = counts[counts > 0]     # 1개 이상 안에 속한 페르소나만
    if membership.size == 0:
        return []
    hist = np.bincount(membership)      # overlap_count -> persona 수
    return [(k, int(hist[k])) for k in range(1, len(hist)) if hist[k] > 0]


def compute_exclusive(cohorts: list[np.ndarray], i: int) -> np.ndarray:
    """안 i 전용층 = Ci ∖ (∪ 나머지). 오직 안 i에만 반응한 인덱스 배열."""
    others = [cohorts[j] for j in range(len(cohorts)) if j != i]
    if others:
        union_others = np.unique(np.concatenate(others))
    else:
        union_others = np.array([], dtype=np.int64)
    return np.setdiff1d(cohorts[i], union_others, assume_unique=True)
