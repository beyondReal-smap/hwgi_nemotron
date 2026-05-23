"""A/B 테스트 전용 LLM 함수 — 당사 장단점·FP 전략 마크다운 생성.

설계:
- analyze 측 generate_report와 동일 패턴 (Anthropic Haiku / sLLM)
- 비교 표·당사 정보·소구점을 한 텍스트 컨텍스트로 압축한 뒤 LLM에 user message로 전달
- to_thread로 routes에서 호출 (gather 가능)
"""

from __future__ import annotations

import json
from collections import Counter

from tenacity import retry, stop_after_attempt, wait_exponential

from models.schemas import ABComparison, ABVariantResult
from services.llm import (
    ABTEST_COMPANY_PROMPT,
    ABTEST_STRATEGY_PROMPT,
    CLAUDE_HAIKU,
    DEFAULT_PROVIDER,
    SLLM_MODEL,
    LLMProvider,
    anthropic_client,
    sllm_client,
)


# ============================================================
# 컨텍스트 빌더 — 두 안 + 비교 표 + 당사 정보를 LLM에 넘길 한 문자열로
# ============================================================

INPUT_MODE_HINTS = {
    "terms": (
        "상품설명서·약관 본문에서 추출한 소구점. 약관에 명시된 보장·특약·면책을 자유롭게 인용 가능."
    ),
    "marketing": (
        "**마케팅 카피·광고 문구에서 인식된 소구점**. "
        "입력은 카피 한두 줄이므로 보장 한도·특약명·만기환급·보험료·가입 연령 등 "
        "**카피에 명시되지 않은 상품 스펙은 한 글자도 만들지 말 것**. "
        "카피의 정서·메시지·암시된 타겟 비교에만 집중하세요."
    ),
    "concept": (
        "신상품 컨셉·핵심 보장 요약에서 추출한 소구점. "
        "요약에 명시된 항목만 인용하고, 미명시 상세 스펙은 만들지 마세요."
    ),
}

# 도전안 성격별 LLM 분석 관점 가이드
CHALLENGER_PERSPECTIVE = {
    "internal": (
        "**당사 다른 상품(내부 포트폴리오 비교)** — 도전안 역시 당사 안의 또 다른 선택지입니다. "
        "관점: '두 안 모두 당사 자원·KPI 내에서 어느 쪽이 더 효율적인지', '두 안을 동시 운영하는 분기 전략이 가능한지'를 평가합니다. "
        "타사·경쟁 위협 톤은 사용하지 마세요."
    ),
    "external": (
        "**타사 상품(경쟁 분석)** — 도전안은 외부 경쟁사 상품/벤치마크입니다. "
        "관점: '경쟁사 강점을 당사가 어떻게 흡수·대응할지', '당사 안이 노출된 시장 위협이 무엇인지', "
        "'당사 차별점을 더 부각시킬 방어 전략은 무엇인지'를 평가합니다. "
        "타사 안을 그대로 채택한다는 표현 대신 '당사가 흡수할 요소' 같은 표현을 쓰세요."
    ),
}


def _variant_block(v: ABVariantResult) -> str:
    """한 안의 핵심 정보를 컨텍스트용 텍스트로."""
    sp = v.selling_points
    pop = v.population_stats
    core = next((c for c in pop.cohorts if c.name == "core"), None)
    target = next((c for c in pop.cohorts if c.name == "target"), None)

    # 상위 페르소나에서 우세 인구통계 추출
    prov_top = Counter(p.province for p in v.top_personas if p.province).most_common(3)
    age_bands: Counter[str] = Counter()
    for p in v.top_personas:
        if p.age is not None:
            age_bands[f"{(p.age // 10) * 10}대"] += 1
    age_top = age_bands.most_common(3)
    fam_top = Counter(p.family_type for p in v.top_personas if p.family_type).most_common(2)
    occ_top = Counter(p.occupation for p in v.top_personas if p.occupation).most_common(5)

    # 의견 요약
    if v.top_opinions:
        avg_intent = sum(o.purchase_intent for o in v.top_opinions) / len(v.top_opinions)
        pos = sum(1 for o in v.top_opinions if o.sentiment == "긍정")
        neg = sum(1 for o in v.top_opinions if o.sentiment == "부정")
        opinion_summary = (
            f"평균 가입의향 {avg_intent:.2f}/5 · 긍정 {pos}/{len(v.top_opinions)}건 · "
            f"부정 {neg}/{len(v.top_opinions)}건"
        )
        opinion_samples = " | ".join(
            f"[{o.sentiment}] {o.opinion_text[:80]}" for o in v.top_opinions[:3]
        )
    else:
        opinion_summary = "(의견 데이터 없음)"
        opinion_samples = "—"

    lines = [
        f"### {v.label}",
        f"- 요약: {sp.summary}",
        f"- 핵심 혜택: {', '.join(sp.key_benefits) if sp.key_benefits else '(미상)'}",
        f"- 타겟 키워드: {', '.join(sp.target_keywords) if sp.target_keywords else '(미상)'}",
        f"- 카테고리 가중치: {json.dumps(sp.persona_category_weights, ensure_ascii=False)}",
        f"- 핵심 타겟 규모(상위 0.5%): {core.size:,}명" if core else "- 핵심 타겟 규모: —",
        f"- 타겟층 규모(상위 5%): {target.size:,}명" if target else "- 타겟층 규모: —",
        f"- 1순위 시도 Top3: {', '.join(f'{n}({c}명)' for n, c in prov_top) if prov_top else '—'}",
        f"- 우세 연령대 Top3: {', '.join(f'{n}({c}명)' for n, c in age_top) if age_top else '—'}",
        f"- 우세 가구 유형: {', '.join(f'{n}({c}명)' for n, c in fam_top) if fam_top else '—'}",
        f"- 주요 직업: {', '.join(f'{n}({c}명)' for n, c in occ_top) if occ_top else '—'}",
        f"- 의견 분포: {opinion_summary}",
        f"- 의견 샘플: {opinion_samples}",
    ]
    return "\n".join(lines)


def _comparison_block(comp: ABComparison) -> str:
    """비교 표를 LLM 컨텍스트용 문자열로."""
    lines = ["### A vs B 비교 표"]
    for row in comp.summary_table:
        winner_tag = (
            f" [{row.winner} 우위]" if row.winner in ("A", "B") else ""
        )
        lines.append(
            f"- {row.label}: A={row.a_value} | B={row.b_value} | 차이={row.delta}{winner_tag}"
        )
    return "\n".join(lines)


def build_abtest_context(
    *,
    company_context: str,
    input_mode: str,
    variant_a: ABVariantResult,
    variant_b: ABVariantResult,
    baseline_variant: str,
    challenger_kind: str,
    comparison: ABComparison,
    recommended: str,
) -> str:
    """당사 장단점·FP 전략 LLM 공통 컨텍스트.

    baseline_variant로 지정된 쪽이 '당사 안', 나머지가 '도전안'.
    challenger_kind("internal" | "external")로 도전안의 성격을 명시해
    LLM이 내부 비교/경쟁 분석 관점을 구분하도록 한다.
    """
    mode_hint = INPUT_MODE_HINTS.get(input_mode, "")
    if baseline_variant == "A":
        baseline_label = variant_a.label
        challenger_label = variant_b.label
    else:
        baseline_label = variant_b.label
        challenger_label = variant_a.label

    challenger_label_kr = (
        "당사 다른 상품" if challenger_kind == "internal" else "타사 상품"
    )
    challenger_perspective = CHALLENGER_PERSPECTIVE.get(challenger_kind, "")

    parts = [
        "## 당사 정보 (사용자 입력)",
        company_context.strip(),
        "",
        f"## 입력 모드: {input_mode} ({mode_hint})",
        "",
        "## 기준안 설정",
        f"- **당사 안(기준)**: '{baseline_label}' ({baseline_variant})",
        f"- **도전안 — {challenger_label_kr}**: '{challenger_label}' ({'B' if baseline_variant == 'A' else 'A'})",
        "",
        "## 도전안의 성격과 분석 관점",
        challenger_perspective,
        "",
        "## 두 안 분석 결과",
        _variant_block(variant_a),
        "",
        _variant_block(variant_b),
        "",
        _comparison_block(comparison),
        "",
        f"## 사전 계산 추천안: {recommended}",
        "(A · B · split 중 하나. split은 타겟별 분기 운영 권장.)",
    ]
    return "\n".join(parts)


# ============================================================
# LLM 호출 — 당사 장단점 / FP 전략
# ============================================================

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def generate_abtest_company_insights(
    *,
    company_context: str,
    input_mode: str,
    variant_a: ABVariantResult,
    variant_b: ABVariantResult,
    baseline_variant: str,
    challenger_kind: str,
    comparison: ABComparison,
    recommended: str,
    provider: LLMProvider = DEFAULT_PROVIDER,
) -> str:
    """당사 정보 중심 A/B 장단점 마크다운 생성."""
    context = build_abtest_context(
        company_context=company_context,
        input_mode=input_mode,
        variant_a=variant_a,
        variant_b=variant_b,
        baseline_variant=baseline_variant,
        challenger_kind=challenger_kind,
        comparison=comparison,
        recommended=recommended,
    )

    if provider == "anthropic":
        msg = anthropic_client().messages.create(
            model=CLAUDE_HAIKU,
            max_tokens=1600,
            system=ABTEST_COMPANY_PROMPT,
            messages=[{"role": "user", "content": context}],
        )
        parts = [b.text for b in msg.content if getattr(b, "type", None) == "text"]
        return "\n".join(parts).strip()

    # sLLM
    completion = sllm_client().chat.completions.create(
        model=SLLM_MODEL,
        max_tokens=1600,
        temperature=0.4,
        messages=[
            {"role": "system", "content": ABTEST_COMPANY_PROMPT},
            {"role": "user", "content": context},
        ],
    )
    return (completion.choices[0].message.content or "").strip()


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def generate_abtest_fp_strategy(
    *,
    company_context: str,
    input_mode: str,
    variant_a: ABVariantResult,
    variant_b: ABVariantResult,
    baseline_variant: str,
    challenger_kind: str,
    comparison: ABComparison,
    recommended: str,
    provider: LLMProvider = DEFAULT_PROVIDER,
) -> str:
    """FP 판매전략 마크다운 (타겟별 어프로치 스크립트 + 채널 추천)."""
    context = build_abtest_context(
        company_context=company_context,
        input_mode=input_mode,
        variant_a=variant_a,
        variant_b=variant_b,
        baseline_variant=baseline_variant,
        challenger_kind=challenger_kind,
        comparison=comparison,
        recommended=recommended,
    )

    if provider == "anthropic":
        msg = anthropic_client().messages.create(
            model=CLAUDE_HAIKU,
            max_tokens=2000,
            system=ABTEST_STRATEGY_PROMPT,
            messages=[{"role": "user", "content": context}],
        )
        parts = [b.text for b in msg.content if getattr(b, "type", None) == "text"]
        return "\n".join(parts).strip()

    # sLLM
    completion = sllm_client().chat.completions.create(
        model=SLLM_MODEL,
        max_tokens=2000,
        temperature=0.5,
        messages=[
            {"role": "system", "content": ABTEST_STRATEGY_PROMPT},
            {"role": "user", "content": context},
        ],
    )
    return (completion.choices[0].message.content or "").strip()
