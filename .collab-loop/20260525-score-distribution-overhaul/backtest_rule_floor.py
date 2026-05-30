"""Plan A 백테스트 — RULE_BONUS_FLOOR 캘리브레이션.

목적: rule_bonus를 '명시 차원만 분모 정규화 + 하한값' 방식으로 바꿀 때,
하한값(floor) 0.05 / 0.1 / 0.2를 어떻게 잡아야 할지 데이터 기반 결정.

비교 대상:
  - baseline: 현재 가산식 (미명시 차원 만점 처리)
  - floor 0.05 / 0.1 / 0.2: 새 정규화 방식

지표:
  - std: 모집단 점수 분포 표준편차 (클수록 spread)
  - p99-p50: 변별력 (클수록 cohort 분리 명확)
  - n_above_75, n_above_70: 절대 컷 통과 인원 (안 간 매력도 비교)
  - top50_avg, top50_target_hit_pct: 상위 50명 평균 점수 + Known-target 통과율

실행: `cd apps/api && python3 ../../.collab-loop/20260525-score-distribution-overhaul/backtest_rule_floor.py`
"""

from __future__ import annotations

import json
import sys
import os
from pathlib import Path

import numpy as np

# 프로젝트 경로 추가
PROJ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJ / "apps" / "api"))

from models.schemas import SellingPoints
from services.scoring import (
    _category_bonus,
    _rule_bonus,
    W_CATEGORY,
    W_COSINE,
    W_RULE,
    build_query_text,
)
from services.llm import embed_text
from services.store import get_store


def rule_bonus_normalized(rows, sp: SellingPoints, floor: float) -> np.ndarray:
    """후보 정규화 방식: 명시 차원만 분모, 미명시 무영향, 하한값 적용."""
    n = len(rows)
    specified = []  # (weight, match_array)

    if sp.target_age_min is not None or sp.target_age_max is not None:
        lo = sp.target_age_min if sp.target_age_min is not None else 0
        hi = sp.target_age_max if sp.target_age_max is not None else 200
        m = (rows["age"].to_numpy() >= lo) & (rows["age"].to_numpy() <= hi)
        specified.append((0.35, m.astype(np.float32)))
    if sp.target_sex:
        m = rows["sex"].isin(sp.target_sex).to_numpy()
        specified.append((0.15, m.astype(np.float32)))
    if sp.target_family_types:
        m = rows["family_type"].isin(sp.target_family_types).to_numpy()
        specified.append((0.15, m.astype(np.float32)))
    if sp.target_education_levels:
        m = rows["education_level"].isin(sp.target_education_levels).to_numpy()
        specified.append((0.15, m.astype(np.float32)))
    if sp.target_occupations:
        import re as _re
        pattern = "|".join(_re.escape(o) for o in sp.target_occupations)
        m = (
            rows["occupation"].fillna("").str.contains(pattern, regex=True, na=False)
        ).to_numpy()
        specified.append((0.20, m.astype(np.float32)))

    if not specified:
        return np.full(n, 0.5, dtype=np.float32)
    total_w = sum(w for w, _ in specified)
    bonus = np.zeros(n, dtype=np.float32)
    for w, match in specified:
        bonus += (w / total_w) * match
    return np.maximum(bonus, floor)


def score_with_rule(
    df, embeddings, query_vec, sp: SellingPoints, rule_arr: np.ndarray
) -> np.ndarray:
    """가산식 그대로. rule_arr만 외부에서 주입."""
    q = query_vec / max(np.linalg.norm(query_vec), 1e-9)
    cosine_all = embeddings @ q.astype(np.float32)
    cosine_norm = (cosine_all + 1.0) / 2.0
    cat_all = _category_bonus(df, sp)
    combined = W_COSINE * cosine_norm + W_RULE * rule_arr + W_CATEGORY * cat_all
    return (combined * 100.0).clip(0, 100).astype(np.float32)


def stats(scores: np.ndarray) -> dict:
    """주요 지표 한 줄로."""
    return {
        "mean": float(scores.mean()),
        "std": float(scores.std()),
        "p50": float(np.percentile(scores, 50)),
        "p95": float(np.percentile(scores, 95)),
        "p99": float(np.percentile(scores, 99)),
        "max": float(scores.max()),
        "spread": float(np.percentile(scores, 99) - np.percentile(scores, 50)),
        "n_above_75": int((scores >= 75).sum()),
        "n_above_70": int((scores >= 70).sum()),
        "n_above_65": int((scores >= 65).sum()),
    }


def target_hit_pct(df, top_idx, sp: SellingPoints) -> float:
    """상위 페르소나 중 명시 타겟(age/sex)에 일치하는 비율 (%)."""
    if len(top_idx) == 0:
        return 0.0
    rows = df.iloc[top_idx]
    hit = np.ones(len(rows), dtype=bool)
    if sp.target_age_min is not None:
        hit &= rows["age"].to_numpy() >= sp.target_age_min
    if sp.target_age_max is not None:
        hit &= rows["age"].to_numpy() <= sp.target_age_max
    if sp.target_sex:
        hit &= rows["sex"].isin(sp.target_sex).to_numpy()
    return float(hit.mean() * 100)


def load_recent_sp_inputs(n: int = 5) -> list[tuple[str, SellingPoints]]:
    """data/abtests.jsonl 마지막 N개 분석에서 (id, variant_a SP) (id, variant_b SP) 추출."""
    path = PROJ / "data" / "abtests.jsonl"
    records = [json.loads(l) for l in open(path)]
    items: list[tuple[str, SellingPoints]] = []
    for rec in records[-n:]:
        for vname in ("variant_a", "variant_b"):
            sp = SellingPoints.model_validate(rec[vname]["selling_points"])
            items.append((f"{rec['id'][:8]}-{vname[-1].upper()}", sp))
    return items


def main():
    print("=" * 100)
    print("Plan A 백테스트 — RULE_BONUS_FLOOR 캘리브레이션")
    print("=" * 100)

    print("\n[1/3] store 로드 중 (100만 행, ~17초)...")
    store = get_store()
    df = store.df
    embeddings = store.embeddings
    print(f"  store loaded: total={store.total:,}")

    cases = load_recent_sp_inputs(n=5)
    print(f"\n[2/3] {len(cases)}개 분석 케이스 로드")

    print("\n[3/3] 각 케이스 × 4개 변형 점수 계산...")
    print()
    floors = [None, 0.05, 0.1, 0.2]  # None = 현재 가산식 baseline
    floor_label = lambda f: "baseline" if f is None else f"floor={f}"

    summary = []  # (case, variant, mean, std, spread, top50_hit_pct)
    for case_id, sp in cases:
        query_text = build_query_text(sp)
        if not query_text.strip():
            continue
        query_vec = embed_text(query_text)
        print(f"\n--- {case_id} ---")
        print(f"  query (de-noised): {query_text[:80]}")
        print(f"  target_age={sp.target_age_min}~{sp.target_age_max}, sex={sp.target_sex}")
        for f in floors:
            if f is None:
                rule_arr = _rule_bonus(df, sp)
            else:
                rule_arr = rule_bonus_normalized(df, sp, f)
            scores = score_with_rule(df, embeddings, query_vec, sp, rule_arr)
            st = stats(scores)
            top50 = np.argpartition(-scores, 50)[:50]
            top50_avg = float(scores[top50].mean())
            t_hit = target_hit_pct(df, top50, sp)
            label = floor_label(f)
            print(
                f"  [{label:<11s}] mean={st['mean']:5.2f} std={st['std']:4.2f} "
                f"spread(p99-p50)={st['spread']:5.2f} "
                f"top50_avg={top50_avg:5.2f} top50_target_hit={t_hit:5.1f}% "
                f"≥75:{st['n_above_75']:>6,} ≥70:{st['n_above_70']:>7,} ≥65:{st['n_above_65']:>7,}"
            )
            summary.append((case_id, label, st["std"], st["spread"], top50_avg, t_hit, st["n_above_75"], st["n_above_70"]))

    # 변형별 평균 요약
    print()
    print("=" * 100)
    print("변형별 평균 요약 (5개 분석 × 2 variant = 10건 케이스 평균)")
    print("=" * 100)
    print(f"{'변형':<12s} {'std':>6s} {'spread(p99-p50)':>16s} {'top50_avg':>10s} {'top50_target_hit':>17s} {'≥75 avg':>10s} {'≥70 avg':>10s}")
    for label in ["baseline", "floor=0.05", "floor=0.1", "floor=0.2"]:
        items = [s for s in summary if s[1] == label]
        if not items:
            continue
        avg_std = np.mean([s[2] for s in items])
        avg_spr = np.mean([s[3] for s in items])
        avg_top = np.mean([s[4] for s in items])
        avg_hit = np.mean([s[5] for s in items])
        avg_75 = np.mean([s[6] for s in items])
        avg_70 = np.mean([s[7] for s in items])
        print(
            f"{label:<12s} {avg_std:>6.2f} {avg_spr:>16.2f} {avg_top:>10.2f} "
            f"{avg_hit:>16.1f}% {avg_75:>10,.0f} {avg_70:>10,.0f}"
        )


if __name__ == "__main__":
    main()
