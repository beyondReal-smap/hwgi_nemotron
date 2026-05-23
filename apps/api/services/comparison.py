"""A vs B 정형 비교 — 두 ABVariantResult로부터 비교 표/카테고리 diff 산출.

LLM을 사용하지 않는 순수 계산. 비교 표는 약 9개 행. 각 행은:
  key, label, a_value, b_value, delta, winner ∈ {A, B, tie}

winner 판단 기준:
- 수치 비교 가능한 항목: 차이가 임계값 이상이면 우위 표시 (예: 평균 점수 ±2점, 규모 ±5%)
- 카테고리 분기 항목: 양쪽이 서로 다른 카테고리/지역이면 'tie'(분기)
"""

from __future__ import annotations

from collections import Counter

from models.schemas import (
    ABComparison,
    ABVariantResult,
    ComparisonRow,
    PersonaHit,
    PersonaOpinion,
    PopulationStats,
)

# 의미 있는 차이로 인정하는 임계값
SCORE_EPSILON = 2.0          # 평균 점수
SIZE_REL_EPSILON = 0.05      # 규모 5% 이상
INTENT_EPSILON = 0.3         # 가입의향 평균 ±0.3
POSITIVE_RATIO_EPSILON = 0.10  # 긍정 비율 10%p


def _cohort(pop: PopulationStats, name: str):
    return next((c for c in pop.cohorts if c.name == name), None)


def _avg_score(personas: list[PersonaHit]) -> float:
    if not personas:
        return 0.0
    return sum(p.score for p in personas) / len(personas)


def _avg_intent(opinions: list[PersonaOpinion]) -> float | None:
    if not opinions:
        return None
    return sum(o.purchase_intent for o in opinions) / len(opinions)


def _positive_ratio(opinions: list[PersonaOpinion]) -> float | None:
    if not opinions:
        return None
    pos = sum(1 for o in opinions if o.sentiment == "긍정")
    return pos / len(opinions)


def _top_category(weights: dict[str, float]) -> tuple[str, float] | None:
    """가중치 사전 → (1위 카테고리, 값). 모두 0이면 None."""
    if not weights:
        return None
    top = max(weights.items(), key=lambda kv: kv[1])
    if top[1] <= 0:
        return None
    return top


def _top_province(personas: list[PersonaHit]) -> tuple[str, int] | None:
    if not personas:
        return None
    c = Counter(p.province for p in personas if p.province)
    if not c:
        return None
    name, cnt = c.most_common(1)[0]
    return name, cnt


def _dominant_age_band(personas: list[PersonaHit]) -> tuple[str, int] | None:
    """10세 단위 band ('20대','30대',...)에서 최대 인원 band."""
    if not personas:
        return None
    bands: Counter[str] = Counter()
    for p in personas:
        if p.age is None:
            continue
        band = f"{(p.age // 10) * 10}대"
        bands[band] += 1
    if not bands:
        return None
    name, cnt = bands.most_common(1)[0]
    return name, cnt


def _dominant_family(personas: list[PersonaHit]) -> tuple[str, int] | None:
    if not personas:
        return None
    c = Counter(p.family_type for p in personas if p.family_type)
    if not c:
        return None
    name, cnt = c.most_common(1)[0]
    return name, cnt


def _fmt_size(n: int | None) -> str:
    if n is None:
        return "—"
    if n >= 10_000:
        return f"{n / 10_000:.1f}만명"
    return f"{n:,}명"


def _fmt_pct(x: float | None) -> str:
    if x is None:
        return "—"
    return f"{x * 100:.0f}%"


def _winner_by_value(a: float | None, b: float | None, epsilon: float) -> str:
    """a, b 비교. None이면 'tie'. |a-b| < epsilon이면 'tie'. 크기 큰 쪽 승."""
    if a is None or b is None:
        return "tie"
    if abs(a - b) < epsilon:
        return "tie"
    return "A" if a > b else "B"


def _winner_by_rel_size(a: int | None, b: int | None, rel_epsilon: float) -> str:
    """규모 상대 비교 — 절대값이 0이거나 작은 쪽 대비 rel_epsilon 미만 차이면 tie."""
    if a is None or b is None:
        return "tie"
    base = max(min(a, b), 1)
    if abs(a - b) / base < rel_epsilon:
        return "tie"
    return "A" if a > b else "B"


def build_comparison(
    a: ABVariantResult,
    b: ABVariantResult,
    input_mode: str = "terms",
) -> ABComparison:
    """ABVariantResult 두 개 → 비교 표 + 카테고리 diff.

    input_mode가 "marketing"이면 일부 행의 라벨을 카피 평가용으로 분기
    ('평균 가입의향' → '평균 관심도' 등).
    """
    is_marketing = input_mode == "marketing"
    intent_label = "평균 관심도 (의견 샘플)" if is_marketing else "평균 가입의향 (의견 샘플)"
    positive_label = "긍정 인상 비율" if is_marketing else "긍정 의견 비율"
    rows: list[ComparisonRow] = []

    # 1) 평균 반응도 점수 (top_personas 상위 50명 평균)
    a_avg = _avg_score(a.top_personas)
    b_avg = _avg_score(b.top_personas)
    w_avg = _winner_by_value(a_avg, b_avg, SCORE_EPSILON)
    delta_avg = (
        "분기 (차이 미미)"
        if w_avg == "tie"
        else f"{abs(a_avg - b_avg):+.1f}점 ({w_avg} 우위)".replace("+-", "-")
    )
    rows.append(ComparisonRow(
        key="avg_score",
        label="평균 반응도 점수",
        a_value=f"{a_avg:.1f}",
        b_value=f"{b_avg:.1f}",
        delta=delta_avg,
        winner=w_avg,  # type: ignore[arg-type]
    ))

    # 2) 핵심 타겟 규모 (core, 상위 0.5%)
    a_core = _cohort(a.population_stats, "core")
    b_core = _cohort(b.population_stats, "core")
    a_core_size = a_core.size if a_core else None
    b_core_size = b_core.size if b_core else None
    w_core = _winner_by_rel_size(a_core_size, b_core_size, SIZE_REL_EPSILON)
    delta_core = (
        "유사 규모"
        if w_core == "tie"
        else f"{abs((a_core_size or 0) - (b_core_size or 0)):,}명 차이 ({w_core} 우위)"
    )
    rows.append(ComparisonRow(
        key="core_size",
        label="핵심 타겟 규모 (상위 0.5%)",
        a_value=_fmt_size(a_core_size),
        b_value=_fmt_size(b_core_size),
        delta=delta_core,
        winner=w_core,  # type: ignore[arg-type]
    ))

    # 3) 타겟층 규모 (target, 상위 5%)
    a_t = _cohort(a.population_stats, "target")
    b_t = _cohort(b.population_stats, "target")
    a_t_size = a_t.size if a_t else None
    b_t_size = b_t.size if b_t else None
    w_t = _winner_by_rel_size(a_t_size, b_t_size, SIZE_REL_EPSILON)
    delta_t = (
        "유사 규모"
        if w_t == "tie"
        else f"{abs((a_t_size or 0) - (b_t_size or 0)):,}명 차이 ({w_t} 우위)"
    )
    rows.append(ComparisonRow(
        key="target_size",
        label="타겟층 규모 (상위 5%)",
        a_value=_fmt_size(a_t_size),
        b_value=_fmt_size(b_t_size),
        delta=delta_t,
        winner=w_t,  # type: ignore[arg-type]
    ))

    # 4) 1순위 페르소나 카테고리
    a_cat = _top_category(a.selling_points.persona_category_weights)
    b_cat = _top_category(b.selling_points.persona_category_weights)
    a_cat_str = f"{a_cat[0]} {a_cat[1]:.2f}" if a_cat else "—"
    b_cat_str = f"{b_cat[0]} {b_cat[1]:.2f}" if b_cat else "—"
    cat_winner = "tie"  # 카테고리 분기는 우위 비교 X (성격 차이로 봄)
    cat_delta = (
        "동일 카테고리"
        if a_cat and b_cat and a_cat[0] == b_cat[0]
        else f"분기 ({a_cat[0] if a_cat else '—'} vs {b_cat[0] if b_cat else '—'})"
    )
    rows.append(ComparisonRow(
        key="top_category",
        label="1순위 페르소나 카테고리",
        a_value=a_cat_str,
        b_value=b_cat_str,
        delta=cat_delta,
        winner=cat_winner,  # type: ignore[arg-type]
    ))

    # 5) 평균 가입의향 (의견 샘플)
    a_intent = _avg_intent(a.top_opinions)
    b_intent = _avg_intent(b.top_opinions)
    w_intent = _winner_by_value(a_intent, b_intent, INTENT_EPSILON)
    delta_intent = (
        "차이 미미"
        if w_intent == "tie" or a_intent is None or b_intent is None
        else f"{abs(a_intent - b_intent):+.2f} ({w_intent} 우위)".replace("+-", "-")
    )
    rows.append(ComparisonRow(
        key="avg_intent",
        label=intent_label,
        a_value=f"{a_intent:.2f} / 5" if a_intent is not None else "—",
        b_value=f"{b_intent:.2f} / 5" if b_intent is not None else "—",
        delta=delta_intent,
        winner=w_intent,  # type: ignore[arg-type]
    ))

    # 6) 긍정 의견 비율
    a_pos = _positive_ratio(a.top_opinions)
    b_pos = _positive_ratio(b.top_opinions)
    w_pos = _winner_by_value(a_pos, b_pos, POSITIVE_RATIO_EPSILON)
    delta_pos = (
        "차이 미미"
        if w_pos == "tie" or a_pos is None or b_pos is None
        else f"{abs(a_pos - b_pos) * 100:+.0f}%p ({w_pos} 우위)".replace("+-", "-")
    )
    rows.append(ComparisonRow(
        key="positive_ratio",
        label=positive_label,
        a_value=_fmt_pct(a_pos),
        b_value=_fmt_pct(b_pos),
        delta=delta_pos,
        winner=w_pos,  # type: ignore[arg-type]
    ))

    # 7) 1순위 시도 (상위 페르소나 기준)
    a_prov = _top_province(a.top_personas)
    b_prov = _top_province(b.top_personas)
    a_prov_str = f"{a_prov[0]} ({a_prov[1]}명)" if a_prov else "—"
    b_prov_str = f"{b_prov[0]} ({b_prov[1]}명)" if b_prov else "—"
    rows.append(ComparisonRow(
        key="top_province",
        label="1순위 시도",
        a_value=a_prov_str,
        b_value=b_prov_str,
        delta=(
            "동일 시도"
            if a_prov and b_prov and a_prov[0] == b_prov[0]
            else f"분기 ({a_prov[0] if a_prov else '—'} vs {b_prov[0] if b_prov else '—'})"
        ),
        winner="tie",  # 지역 분기도 성격 차이
    ))

    # 8) 우세 연령대
    a_age = _dominant_age_band(a.top_personas)
    b_age = _dominant_age_band(b.top_personas)
    rows.append(ComparisonRow(
        key="dominant_age",
        label="우세 연령대",
        a_value=f"{a_age[0]} ({a_age[1]}명)" if a_age else "—",
        b_value=f"{b_age[0]} ({b_age[1]}명)" if b_age else "—",
        delta=(
            "동일 연령대"
            if a_age and b_age and a_age[0] == b_age[0]
            else f"분기 ({a_age[0] if a_age else '—'} vs {b_age[0] if b_age else '—'})"
        ),
        winner="tie",
    ))

    # 9) 우세 가구 유형
    a_fam = _dominant_family(a.top_personas)
    b_fam = _dominant_family(b.top_personas)
    rows.append(ComparisonRow(
        key="dominant_family",
        label="우세 가구 유형",
        a_value=f"{a_fam[0]} ({a_fam[1]}명)" if a_fam else "—",
        b_value=f"{b_fam[0]} ({b_fam[1]}명)" if b_fam else "—",
        delta=(
            "동일 가구"
            if a_fam and b_fam and a_fam[0] == b_fam[0]
            else f"분기 ({a_fam[0] if a_fam else '—'} vs {b_fam[0] if b_fam else '—'})"
        ),
        winner="tie",
    ))

    # 카테고리 가중치 diff (전 카테고리)
    a_w = a.selling_points.persona_category_weights or {}
    b_w = b.selling_points.persona_category_weights or {}
    category_diff: dict[str, dict[str, float]] = {}
    for cat in sorted(set(a_w.keys()) | set(b_w.keys())):
        av = float(a_w.get(cat, 0.0))
        bv = float(b_w.get(cat, 0.0))
        category_diff[cat] = {"a": av, "b": bv, "delta": bv - av}

    return ABComparison(summary_table=rows, category_diff=category_diff)


def recommend_variant(a: ABVariantResult, b: ABVariantResult, comp: ABComparison) -> str:
    """비교 표 winner 분포 → 'A' / 'B' / 'split'.

    규칙: 수치 비교 가능한 항목들(평균점수/규모/가입의향/긍정비율)에서
    한쪽이 절대 다수면 그쪽 추천. 균등하거나 분기 항목이 많으면 'split'.
    """
    numeric_keys = {
        "avg_score",
        "core_size",
        "target_size",
        "avg_intent",
        "positive_ratio",
    }
    a_wins = sum(1 for r in comp.summary_table if r.key in numeric_keys and r.winner == "A")
    b_wins = sum(1 for r in comp.summary_table if r.key in numeric_keys and r.winner == "B")

    # 명확한 우세: 3승 이상 차이
    if a_wins - b_wins >= 3:
        return "A"
    if b_wins - a_wins >= 3:
        return "B"
    return "split"
