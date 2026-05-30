"""Track 2·4 평가 스크립트 — 4셀(baseline/T4/T2/T4+T2) 자동 측정.

종속 환경변수 (feature flag):
  ENABLE_QUERY_MULTIVEC=1   → Track 4 (query multi-vector) 활성
  ENABLE_CATEGORY_EMB=1     → Track 2 (category 임베딩) 활성
  CAT_EMB_NORM_METHOD=z     → z-score | raw | percentile
  QUERY_POOL_METHOD=max+w   → max+weighted | weighted | max

사용:
  # 4셀 모두 측정 (한 번 실행으로)
  cd apps/api && .venv/bin/python ../../.collab-loop/20260525-embedding-quality-tracks/evaluate_tracks.py

산출:
  .collab-loop/20260525-embedding-quality-tracks/eval_results.jsonl
  콘솔에 4셀 요약 표
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

import numpy as np

PROJ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJ / "apps" / "api"))

from models.schemas import SellingPoints
from services.llm import embed_text
from services.scoring import build_query_text, score_all_personas
from services.store import get_store

SESSION_DIR = PROJ / ".collab-loop" / "20260525-embedding-quality-tracks"
STRESS_PATH = SESSION_DIR / "stress_set.jsonl"
KNOWN_TARGET_RECORDS = 11  # data/abtests.jsonl 마지막 N개 (기존 골든셋)


# ============================================================
# 평가 케이스 로딩
# ============================================================

def load_stress_set() -> list[dict]:
    """stress_set.jsonl → 케이스 리스트."""
    return [json.loads(l) for l in open(STRESS_PATH)]


def load_known_target_set(n: int) -> list[dict]:
    """data/abtests.jsonl 마지막 n개에서 variant_a SP를 추출 (회귀 골든셋)."""
    path = PROJ / "data" / "abtests.jsonl"
    records = [json.loads(l) for l in open(path)]
    out = []
    for rec in records[-n:]:
        for vname in ("variant_a", "variant_b"):
            sp = rec[vname]["selling_points"]
            out.append({
                "id": f"{rec['id'][:8]}-{vname[-1].upper()}",
                **sp,
                "_origin": "known_target",
            })
    return out


def sp_from_case(case: dict) -> SellingPoints:
    """평가 케이스 dict → SellingPoints. 누락 필드 default."""
    return SellingPoints(
        summary=case.get("summary", ""),
        key_benefits=case.get("key_benefits", []),
        target_age_min=case.get("target_age_min"),
        target_age_max=case.get("target_age_max"),
        target_sex=case.get("target_sex", []),
        target_family_types=case.get("target_family_types", []),
        target_education_levels=case.get("target_education_levels", []),
        target_occupations=case.get("target_occupations", []),
        target_keywords=case.get("target_keywords", []),
        persona_category_weights=case.get(
            "persona_category_weights",
            {"professional": 0.0, "sports": 0.0, "arts": 0.0,
             "travel": 0.0, "culinary": 0.0, "family": 0.0},
        ),
    )


# ============================================================
# 셀별 점수 계산 (구현 추가될 때 채워질 자리)
# ============================================================

def run_baseline(sp: SellingPoints, store) -> dict:
    """현재 점수 계산 그대로 (Track 4·2 미적용)."""
    qtext = build_query_text(sp)
    qvec = embed_text(qtext) if qtext.strip() else np.zeros(1536, dtype=np.float32)
    all_scores, pop = score_all_personas(sp, qvec, store)
    return _hit_stats(all_scores, store, sp)


def run_t4_only(sp: SellingPoints, store) -> dict:
    """Track 4만 적용 — query multi-vector. (구현 후 채움)"""
    # TODO: services.scoring에 ENABLE_QUERY_MULTIVEC=1 토글 구현 후
    os.environ["ENABLE_QUERY_MULTIVEC"] = "1"
    os.environ["ENABLE_CATEGORY_EMB"] = "0"
    try:
        return run_baseline(sp, store)
    finally:
        os.environ.pop("ENABLE_QUERY_MULTIVEC", None)


def run_t2_only(sp: SellingPoints, store) -> dict:
    """Track 2만 적용 — category embedding. (구현 후 채움)"""
    os.environ["ENABLE_QUERY_MULTIVEC"] = "0"
    os.environ["ENABLE_CATEGORY_EMB"] = "1"
    try:
        return run_baseline(sp, store)
    finally:
        os.environ.pop("ENABLE_CATEGORY_EMB", None)


def run_t4_plus_t2(sp: SellingPoints, store) -> dict:
    """둘 다 적용."""
    os.environ["ENABLE_QUERY_MULTIVEC"] = "1"
    os.environ["ENABLE_CATEGORY_EMB"] = "1"
    try:
        return run_baseline(sp, store)
    finally:
        os.environ.pop("ENABLE_QUERY_MULTIVEC", None)
        os.environ.pop("ENABLE_CATEGORY_EMB", None)


# ============================================================
# 지표 추출
# ============================================================

def _hit_stats(all_scores: np.ndarray, store, sp: SellingPoints) -> dict:
    """상위 50명에 대한 지표 + 분포."""
    n = len(all_scores)
    top_n = min(50, n)
    top_idx = np.argpartition(-all_scores, top_n - 1)[:top_n]
    top_idx = top_idx[np.argsort(-all_scores[top_idx])]
    top_rows = store.df.iloc[top_idx]
    top_scores = all_scores[top_idx]

    # known-target 통과율
    hit = np.ones(len(top_rows), dtype=bool)
    if sp.target_age_min is not None:
        hit &= top_rows["age"].to_numpy() >= sp.target_age_min
    if sp.target_age_max is not None:
        hit &= top_rows["age"].to_numpy() <= sp.target_age_max
    if sp.target_sex:
        hit &= top_rows["sex"].isin(sp.target_sex).to_numpy()

    # dominant category 추출 — 상위 50명의 카테고리 텍스트 길이로 추정
    cat_cols = ["family_persona", "professional_persona", "sports_persona",
                "arts_persona", "travel_persona", "culinary_persona"]
    cat_lens = {c.replace("_persona", ""): top_rows[c].fillna("").str.len().mean() for c in cat_cols}
    top1_cat = max(cat_lens, key=cat_lens.get) if cat_lens else None

    return {
        "top50_avg_score": float(top_scores.mean()),
        "top50_target_hit_pct": float(hit.mean() * 100),
        "raw_mean": float(all_scores.mean()),
        "raw_std": float(all_scores.std()),
        "raw_p99_minus_p50": float(np.percentile(all_scores, 99) - np.percentile(all_scores, 50)),
        "n_above_75": int((all_scores >= 75).sum()),
        "n_above_70": int((all_scores >= 70).sum()),
        "top1_dominant_category_estimated": top1_cat,
        "top50_category_text_avg_len": cat_lens,
        "top50_occupations": dict(top_rows["occupation"].value_counts().head(5).to_dict()),
    }


# ============================================================
# 메인
# ============================================================

def main():
    print("=" * 100)
    print("Track 2·4 평가 — 4셀 측정")
    print("=" * 100)

    print("\n[1/4] store 로드 중 (~17초)...")
    store = get_store()
    print(f"  loaded: total={store.total:,}")

    print("\n[2/4] 평가 케이스 로드...")
    stress = load_stress_set()
    known = load_known_target_set(KNOWN_TARGET_RECORDS)
    print(f"  stress set: {len(stress)}개")
    print(f"  known target (기존 abtest): {len(known)}개")

    out_path = SESSION_DIR / "eval_results.jsonl"
    out = open(out_path, "w")

    print("\n[3/4] 셀별 측정...")
    cells = [
        ("baseline", run_baseline),
        # Track 4·2 구현 완료 후 활성화:
        # ("t4_only",  run_t4_only),
        # ("t2_only",  run_t2_only),
        # ("t4+t2",    run_t4_plus_t2),
    ]
    case_groups = [("stress", stress), ("known", known)]

    summary: dict[str, list[dict]] = {cell: [] for cell, _ in cells}
    for cell_name, cell_fn in cells:
        print(f"\n--- cell: {cell_name} ---")
        for group_name, cases in case_groups:
            for case in cases:
                sp = sp_from_case(case)
                stats = cell_fn(sp, store)
                # dominant_match: stress set일 때만 의미
                if group_name == "stress":
                    expected = case.get("expected_dominant", [])
                    secondary = case.get("expected_secondary", [])
                    actual = stats.get("top1_dominant_category_estimated")
                    stats["expected_top1"] = expected[0] if expected else None
                    stats["expected_secondary"] = secondary
                    stats["top1_match"] = actual == (expected[0] if expected else None)
                stats["case_id"] = case.get("id", "?")
                stats["case_group"] = group_name
                stats["cell"] = cell_name
                summary[cell_name].append(stats)
                out.write(json.dumps(stats, ensure_ascii=False) + "\n")
                hit = stats.get("top50_target_hit_pct", 0)
                match = "✓" if stats.get("top1_match", None) is True else ("✗" if stats.get("top1_match") is False else " ")
                print(f"  [{group_name}] {stats['case_id']:<15s} top50_hit={hit:5.1f}% raw_mean={stats['raw_mean']:5.2f} top1_cat={stats.get('top1_dominant_category_estimated','?'):<12s} match={match}")

    out.close()

    print("\n[4/4] 셀별 요약")
    print("=" * 100)
    print(f"{'cell':<12s} {'known_hit_avg':>14s} {'stress_top1_match_pct':>22s} {'raw_mean_avg':>14s} {'spread_avg':>12s}")
    for cell_name, _ in cells:
        items = summary[cell_name]
        known_items = [s for s in items if s["case_group"] == "known"]
        stress_items = [s for s in items if s["case_group"] == "stress"]
        khit = np.mean([s["top50_target_hit_pct"] for s in known_items]) if known_items else 0
        smatch = np.mean([100.0 if s.get("top1_match") else 0.0 for s in stress_items]) if stress_items else 0
        rmean = np.mean([s["raw_mean"] for s in items])
        spread = np.mean([s["raw_p99_minus_p50"] for s in items])
        print(f"{cell_name:<12s} {khit:>13.1f}% {smatch:>21.1f}% {rmean:>14.2f} {spread:>12.2f}")

    print(f"\n결과 저장: {out_path}")


if __name__ == "__main__":
    main()
