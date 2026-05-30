"""A vs B 정형 비교 — 두 ABVariantResult로부터 비교 표/카테고리 diff 산출.

LLM을 사용하지 않는 순수 계산. 비교 표는 약 9개 행. 각 행은:
  key, label, a_value, b_value, delta, winner ∈ {A, B, tie}

winner 판단 기준:
- 수치 비교 가능한 항목: 차이가 임계값 이상이면 우위 표시 (예: 평균 점수 ±2점, 규모 ±5%)
- 카테고리 분기 항목: 양쪽이 서로 다른 카테고리/지역이면 'tie'(분기)
"""

from __future__ import annotations


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


def _scoring_version(stats) -> str:
    """PopulationStats의 점수 체계 버전. 옛 레코드는 필드 부재 → 'v1'(percentile-rank)."""
    return getattr(stats, "scoring_version", None) or "v1"


def _ver_label(v: str) -> str:
    return "신(하이브리드)" if v == "v2_hybrid" else "구(균등매핑)"


# 점수 체계에 의존하는 비교 행 — 버전 불일치(구↔신) 시 직접 비교 보류.
# 의견 기반(avg_intent/positive_ratio)·demographics 비율 행은 체계와 무관해 유지.
_SCORE_DEPENDENT_KEYS = {
    "avg_score", "core_size", "raw_mean", "core_lift", "n_above_65", "target_size",
}


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


def _demo_top1(pop, column: str) -> tuple[str, int] | None:
    """population_stats.demographics(타겟 cohort 전체 기준)에서 최대 인원 항목.

    이전엔 top_personas(상위 50명 카드 표본)에서 셌는데, 그러면 '40대 11명'처럼
    표본 카운트가 나와 핵심 타겟 규모(수만 명)와 모순돼 표·LLM이 잘못 서술했다.
    전체 분포(demographics)에서 집계한다. column: 'province'/'age'/'family_type'.
    """
    g = next((g for g in pop.demographics if g.column == column), None)
    if not g or not g.bins:
        return None
    top = max(g.bins, key=lambda b: b.count)
    return top.label, int(top.count)


def _fmt_size(n: int | None) -> str:
    if n is None:
        return "—"
    if n >= 10_000:
        return f"{n / 10_000:.1f}만명"
    return f"{n:,}명"


def _fmt_size_with_mode(c) -> str:
    """크기 + 컷 모드 힌트. 절대 컷이면 점수 임계값, percentile 폴백이면 그 사실을 표기.

    예) absolute → "3,099명 (점수 ≥75)"
        percentile 폴백 → "5,001명 (상위 0.5% 폴백)"
    """
    if c is None:
        return "—"
    base = _fmt_size(c.size)
    mode = getattr(c, "mode", None)
    if mode == "absolute":
        thr = getattr(c, "threshold_absolute", None)
        return f"{base} (점수 ≥{thr:.0f})" if thr is not None else base
    if mode == "percentile":
        return f"{base} (상위 {c.percentile}% 폴백)"
    return base


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


def _size_row(
    *,
    key: str,
    base_label: str,
    cohort_a,
    cohort_b,
) -> ComparisonRow:
    """규모 비교 행 — cohort의 cut mode를 라벨/델타에 반영.

    동기: cohort는 절대 점수 컷이 1순위, 인원이 너무 적으면 percentile 폴백.
    A·B가 서로 다른 모드로 잘리면 인원만 비교하면 안 됨 (예: A는 상위 5% 폴백 5만 명,
    B는 점수 75↑ 절대 컷 3,099명). 모드가 다르면 'tie + 기준 차이'로 표기.
    """
    if cohort_a is None or cohort_b is None:
        return ComparisonRow(
            key=key,
            label=base_label,
            a_value=_fmt_size_with_mode(cohort_a),
            b_value=_fmt_size_with_mode(cohort_b),
            delta="—",
            winner="tie",
        )

    mode_a = getattr(cohort_a, "mode", None)
    mode_b = getattr(cohort_b, "mode", None)
    mode_mismatch = mode_a is not None and mode_b is not None and mode_a != mode_b

    # 라벨에 컷 기준을 표시. 동일 모드면 한 줄로, 혼재면 별도 표기.
    if mode_a == mode_b == "absolute":
        thr = getattr(cohort_a, "threshold_absolute", None)
        label = f"{base_label} (점수 ≥{thr:.0f})" if thr is not None else base_label
    elif mode_a == mode_b == "percentile":
        label = f"{base_label} (상위 {cohort_a.percentile}% 폴백)"
    else:
        label = f"{base_label} (컷 기준 다름)"

    if mode_mismatch:
        # 컷 기준이 다른 cohort 인원 차이는 의미 없음(절대 점수 vs percentile 폴백) →
        # 숫자 인용 자체를 빼고 사유만 남긴다.
        delta = "비교 보류 — A·B 컷 기준 달라 인원 직접 비교 부적합"
        winner = "tie"
    else:
        winner = _winner_by_rel_size(cohort_a.size, cohort_b.size, SIZE_REL_EPSILON)
        if winner == "tie":
            delta = "유사 규모"
        else:
            delta = f"{abs(cohort_a.size - cohort_b.size):,}명 차이 ({winner} 우위)"

    return ComparisonRow(
        key=key,
        label=label,
        a_value=_fmt_size_with_mode(cohort_a),
        b_value=_fmt_size_with_mode(cohort_b),
        delta=delta,
        winner=winner,  # type: ignore[arg-type]
    )


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

    # 2) 핵심 타겟 규모 (core)
    # 절대 컷(점수 ≥75) 적중 vs percentile 폴백(상위 0.5%)이 섞이면
    # 두 cohort는 다른 기준으로 만들어진 셈이라 단순 인원 비교가 깨진다.
    # 모드가 같을 때만 규모 우위를 인정하고, 다르면 'tie + 기준 차이'로 표시.
    a_core = _cohort(a.population_stats, "core")
    b_core = _cohort(b.population_stats, "core")
    rows.append(_size_row(
        key="core_size",
        base_label="핵심 타겟 규모",
        cohort_a=a_core,
        cohort_b=b_core,
    ))

    # 2-b) raw 모집단 평균 — cohort 인원이 모드 차이로 비교 보류돼도
    # 안 간 매력도 차이가 raw 평균으로 노출된다 (PR-1).
    a_raw = a.population_stats.raw_mean
    b_raw = b.population_stats.raw_mean
    if a_raw is not None and b_raw is not None:
        w_raw = _winner_by_value(a_raw, b_raw, 0.5)  # raw 분포가 좁아 0.5점도 의미
        delta_raw = (
            "차이 미미"
            if w_raw == "tie"
            else f"{abs(a_raw - b_raw):+.2f}점 ({w_raw} 우위)".replace("+-", "-")
        )
        rows.append(ComparisonRow(
            key="raw_mean",
            label="모집단 평균 raw 점수",
            a_value=f"{a_raw:.2f}",
            b_value=f"{b_raw:.2f}",
            delta=delta_raw,
            winner=w_raw,  # type: ignore[arg-type]
        ))

    # 2-c) core lift — core cohort가 모집단 평균 대비 얼마나 높은지
    a_lift = a.population_stats.core_lift
    b_lift = b.population_stats.core_lift
    if a_lift is not None and b_lift is not None:
        w_lift = _winner_by_value(a_lift, b_lift, 0.3)
        delta_lift = (
            "차이 미미"
            if w_lift == "tie"
            else f"{abs(a_lift - b_lift):+.2f}점 ({w_lift} 우위)".replace("+-", "-")
        )
        rows.append(ComparisonRow(
            key="core_lift",
            label="핵심 cohort 리프트 (모집단 대비)",
            a_value=f"+{a_lift:.2f}",
            b_value=f"+{b_lift:.2f}",
            delta=delta_lift,
            winner=w_lift,  # type: ignore[arg-type]
        ))

    # 2-d) 고정 컷 통과 인원 (raw ≥80, ≥65) — 안 간 절대 매력도 비교
    a_n65 = a.population_stats.n_above_65
    b_n65 = b.population_stats.n_above_65
    if a_n65 is not None and b_n65 is not None:
        w_n65 = _winner_by_rel_size(a_n65, b_n65, 0.10)
        delta_n65 = (
            "유사 규모"
            if w_n65 == "tie"
            else f"{abs(a_n65 - b_n65):,}명 차이 ({w_n65} 우위)"
        )
        rows.append(ComparisonRow(
            key="n_above_65",
            label="점수 ≥65 인원 ('높음' 컷)",
            a_value=_fmt_size(a_n65),
            b_value=_fmt_size(b_n65),
            delta=delta_n65,
            winner=w_n65,  # type: ignore[arg-type]
        ))

    # 3) 타겟층 규모 (target)
    a_t = _cohort(a.population_stats, "target")
    b_t = _cohort(b.population_stats, "target")
    rows.append(_size_row(
        key="target_size",
        base_label="타겟층 규모",
        cohort_a=a_t,
        cohort_b=b_t,
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

    # 7) 1순위 시도 (타겟층 전체 기준)
    a_prov = _demo_top1(a.population_stats, "province")
    b_prov = _demo_top1(b.population_stats, "province")
    a_prov_str = f"{a_prov[0]} ({a_prov[1]:,}명)" if a_prov else "—"
    b_prov_str = f"{b_prov[0]} ({b_prov[1]:,}명)" if b_prov else "—"
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

    # 8) 우세 연령대 (타겟층 전체 기준)
    a_age = _demo_top1(a.population_stats, "age")
    b_age = _demo_top1(b.population_stats, "age")
    rows.append(ComparisonRow(
        key="dominant_age",
        label="우세 연령대",
        a_value=f"{a_age[0]} ({a_age[1]:,}명)" if a_age else "—",
        b_value=f"{b_age[0]} ({b_age[1]:,}명)" if b_age else "—",
        delta=(
            "동일 연령대"
            if a_age and b_age and a_age[0] == b_age[0]
            else f"분기 ({a_age[0] if a_age else '—'} vs {b_age[0] if b_age else '—'})"
        ),
        winner="tie",
    ))

    # 9) 우세 가구 유형 (타겟층 전체 기준)
    a_fam = _demo_top1(a.population_stats, "family_type")
    b_fam = _demo_top1(b.population_stats, "family_type")
    rows.append(ComparisonRow(
        key="dominant_family",
        label="우세 가구 유형",
        a_value=f"{a_fam[0]} ({a_fam[1]:,}명)" if a_fam else "—",
        b_value=f"{b_fam[0]} ({b_fam[1]:,}명)" if b_fam else "—",
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

    # 점수 체계 버전 불일치(구 v1 ↔ 신 v2) → 분포가 근본적으로 달라(균등 vs 종형)
    # 점수·인원 직접 비교가 왜곡됨. 해당 행 winner를 보류하고 맨 앞에 경고 행을 둔다.
    v_a, v_b = _scoring_version(a.population_stats), _scoring_version(b.population_stats)
    if v_a != v_b:
        rows = [
            r.model_copy(update={"winner": "tie", "delta": "점수 체계 상이(구↔신) — 비교 보류"})
            if r.key in _SCORE_DEPENDENT_KEYS else r
            for r in rows
        ]
        rows.insert(0, ComparisonRow(
            key="scoring_version",
            label="⚠️ 점수 체계",
            a_value=_ver_label(v_a),
            b_value=_ver_label(v_b),
            delta="A·B 점수 산출 체계가 달라 점수·인원 직접 비교는 참고용입니다",
            winner="tie",
        ))

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
