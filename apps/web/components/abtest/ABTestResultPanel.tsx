"use client";

import ReactMarkdown from "react-markdown";
import type {
  ABChallengerKind,
  ABTestInputMode,
  ABTestResponse,
  ABVariantResult,
  PersonaHit,
  PersonaOpinion,
} from "@/lib/api";
import { ComparisonTable } from "./ComparisonTable";
import { DemographicCard } from "@/components/DistributionCharts";

type Props = {
  result: ABTestResponse;
};

const PROSE_CLASS =
  "prose max-w-none text-[14px] sm:text-[15px] leading-7 break-words " +
  "prose-headings:text-ink prose-headings:tracking-tight " +
  "prose-h2:text-[18px] sm:prose-h2:text-[20px] prose-h2:font-semibold prose-h2:mt-6 sm:prose-h2:mt-7 prose-h2:mb-3 prose-h2:pb-2 prose-h2:border-b prose-h2:border-parchment " +
  "prose-h3:text-[15px] prose-h3:font-semibold prose-h3:mt-5 prose-h3:mb-2 " +
  "prose-p:my-3 prose-p:text-graphite prose-p:leading-7 " +
  "prose-ul:my-3 prose-li:my-1.5 prose-li:text-graphite " +
  "prose-ol:my-3 prose-ol:text-graphite prose-li:leading-7 " +
  "prose-strong:text-ink prose-strong:font-semibold " +
  "prose-code:text-ink prose-code:bg-azure/40 prose-code:px-1 prose-code:rounded prose-code:text-[0.9em] " +
  "prose-code:before:content-[''] prose-code:after:content-['']";

export function ABTestResultPanel({ result }: Props) {
  const {
    variant_a,
    variant_b,
    comparison,
    company_insights_md,
    fp_strategy_md,
    recommended_variant,
    baseline_variant,
    challenger_kind,
    input_mode,
  } = result;

  return (
    <div className="space-y-6">
      {/* 한눈에 비교 — 추천안 배지 + A·B 핵심 수치 */}
      <RecommendationCard
        recommended={recommended_variant}
        baseline={baseline_variant}
        challengerKind={challenger_kind}
        a={variant_a}
        b={variant_b}
      />

      {/* 좌우 분할 결과 */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <VariantSummaryCard
          variant={variant_a}
          accent="A"
          isBaseline={baseline_variant === "A"}
          challengerKind={challenger_kind}
          inputMode={input_mode}
        />
        <VariantSummaryCard
          variant={variant_b}
          accent="B"
          isBaseline={baseline_variant === "B"}
          challengerKind={challenger_kind}
          inputMode={input_mode}
        />
      </section>

      {/* 비교 표 */}
      <ComparisonTable
        labelA={variant_a.label}
        labelB={variant_b.label}
        comparison={comparison}
        inputMode={input_mode}
      />

      {/* 인구통계 분포 비교 — 각 안의 타겟층 기준 (현황·분석과 동일한 차트 카드) */}
      <DemographicComparisonSection a={variant_a} b={variant_b} />

      {/* 당사 관점 장단점 */}
      <MarkdownSection
        title="당사 관점 장단점"
        subtitle="입력하신 당사 정보를 기준으로 본 두 안의 강점·약점"
        markdown={company_insights_md}
      />

      {/* FP 판매전략 */}
      <MarkdownSection
        title="FP 판매·마케팅 전략"
        subtitle="타겟별 어프로치 스크립트 + 채널 추천"
        markdown={fp_strategy_md}
        accent="terra"
      />
    </div>
  );
}

// ============================================================
// 인구통계 분포 비교 — A·B 좌우 배치, 각 안의 타겟층 기준 demographics
// ============================================================

function DemographicComparisonSection({
  a,
  b,
}: {
  a: ABVariantResult;
  b: ABVariantResult;
}) {
  return (
    <section className="border border-parchment border-l-4 border-l-terra rounded-[9.6px] bg-vellum overflow-hidden">
      <header className="bg-snow border-b border-parchment px-4 py-3 sm:px-5 sm:py-4">
        <h2 className="text-title text-ink">인구통계 분포 비교</h2>
        <p className="text-body-sm text-dusty mt-1">
          각 안의 타겟층 기준 인구통계 분포 (Nemotron 카테고리)
        </p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-parchment">
        <VariantDemographics variant={a} accent="A" />
        <VariantDemographics variant={b} accent="B" />
      </div>
    </section>
  );
}

function VariantDemographics({
  variant,
  accent,
}: {
  variant: ABVariantResult;
  accent: "A" | "B";
}) {
  return (
    <div className="p-4">
      <h3 className="flex items-center gap-2 text-heading text-ink mb-3">
        <span
          className={`inline-flex items-center justify-center w-5 h-5 rounded-[5px] text-overline font-semibold
            ${accent === "A" ? "bg-azure/30 text-ink" : "bg-terra/20 text-terra"}`}
        >
          {accent}
        </span>
        <span className="truncate" title={variant.label}>
          {variant.label}
        </span>
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {variant.population_stats.demographics.map((g) => (
          <DemographicCard
            key={g.column}
            dem={{ column: g.column, label: g.label, bins: g.bins }}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================================
// 추천안 배지 + 요약 카드
// ============================================================

function RecommendationCard({
  recommended,
  baseline,
  challengerKind,
  a,
  b,
}: {
  recommended: "A" | "B" | "split";
  baseline: "A" | "B";
  challengerKind: ABChallengerKind;
  a: ABVariantResult;
  b: ABVariantResult;
}) {
  const recommendedLabel =
    recommended === "A"
      ? a.label
      : recommended === "B"
        ? b.label
        : "타겟별 분기 운영";

  // 기준안 대비 추천 의미 — 도전안 성격(internal/external)에 따라 톤이 달라짐
  const baselineLabel = baseline === "A" ? a.label : b.label;
  const challengerLabel = baseline === "A" ? b.label : a.label;
  const isInternal = challengerKind === "internal";

  let verdict: string;
  if (recommended === "split") {
    verdict = isInternal
      ? `기준안 '${baselineLabel}'과 도전안 '${challengerLabel}'을 당사 포트폴리오 내에서 타겟별로 분기 운영하는 것이 적합합니다.`
      : `타사가 강한 영역과 당사가 우위인 영역을 분리해 대응(차별화 + 방어)하는 것이 적합합니다.`;
  } else if (recommended === baseline) {
    verdict = isInternal
      ? `기준안 '${baselineLabel}'을 유지하는 것이 데이터상 유리합니다.`
      : `기준안 '${baselineLabel}'을 방어하며 타사 강점을 부분 흡수하는 것이 적합합니다.`;
  } else {
    verdict = isInternal
      ? `기준안 '${baselineLabel}' 대비 도전안 채택이 데이터상 유리합니다.`
      : `타사 강점을 흡수해 기준안 '${baselineLabel}'을 보완하는 것이 적합합니다.`;
  }

  return (
    <section className="rounded-[9.6px] border border-parchment bg-snow/40 p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <p className="text-overline text-graphite">추천안</p>
            <ChallengerKindBadge kind={challengerKind} />
          </div>
          <h2 className="text-display text-ink tracking-tight">
            {recommendedLabel}
          </h2>
          <p className="text-body-sm text-graphite mt-1">{verdict}</p>
        </div>
        <RecommendationBadge value={recommended} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
        <MiniStatCard
          variant={a}
          accent="A"
          isBaseline={baseline === "A"}
          challengerKind={challengerKind}
        />
        <MiniStatCard
          variant={b}
          accent="B"
          isBaseline={baseline === "B"}
          challengerKind={challengerKind}
        />
      </div>
    </section>
  );
}

/** 비교 모드 배지 — 사용자가 어떤 종류의 비교를 했는지 한눈에. */
function ChallengerKindBadge({ kind }: { kind: ABChallengerKind }) {
  if (kind === "internal") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded-[5px] bg-azure/20 text-ink text-overline font-medium border border-azure/30">
        내부 비교 (당사 vs 당사)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-[5px] bg-terra/15 text-terra text-overline font-medium border border-terra/30">
      경쟁 분석 (당사 vs 타사)
    </span>
  );
}

function RecommendationBadge({ value }: { value: "A" | "B" | "split" }) {
  if (value === "split") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] bg-azure/20 text-ink text-body-sm font-semibold border border-azure/30">
        분기 운영 권장
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] text-body-sm font-semibold border
                  ${
                    value === "A"
                      ? "bg-azure/20 text-ink border-azure/30"
                      : "bg-terra/15 text-terra border-terra/30"
                  }`}
    >
      {value} 우위
    </span>
  );
}

function MiniStatCard({
  variant,
  accent,
  isBaseline,
  challengerKind,
}: {
  variant: ABVariantResult;
  accent: "A" | "B";
  isBaseline: boolean;
  challengerKind: ABChallengerKind;
}) {
  const { selling_points, top_personas, population_stats } = variant;
  const core = population_stats.cohorts.find((c) => c.name === "core");
  const target = population_stats.cohorts.find((c) => c.name === "target");
  const avgScore = top_personas.length
    ? top_personas.reduce((s, p) => s + p.score, 0) / top_personas.length
    : 0;

  const cardClass = isBaseline
    ? "border-l-4 border-l-ink bg-vellum"
    : "bg-vellum";

  return (
    <div className={`rounded-[7px] border border-parchment ${cardClass} p-3`}>
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`inline-flex items-center justify-center w-6 h-6 rounded-[5px] text-caption font-bold
                      ${accent === "A" ? "bg-azure/30 text-ink" : "bg-terra/20 text-terra"}`}
        >
          {accent}
        </span>
        <span className="text-body-sm font-semibold text-ink truncate" title={variant.label}>
          {variant.label}
        </span>
        {isBaseline ? (
          <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-[5px] bg-ink text-vellum text-overline font-semibold">
            당사 안
          </span>
        ) : (
          <span
            className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-[5px] text-overline font-medium border
                        ${
                          challengerKind === "internal"
                            ? "bg-snow text-graphite border-parchment"
                            : "bg-terra/10 text-terra border-terra/30"
                        }`}
          >
            {challengerKind === "internal" ? "당사 다른 상품" : "타사 상품"}
          </span>
        )}
      </div>
      <p className="text-caption text-dusty mb-1.5 line-clamp-2">{selling_points.summary}</p>
      <div className="grid grid-cols-3 gap-2 text-center mt-2">
        <Stat label="평균 점수" value={avgScore.toFixed(1)} />
        <Stat
          label="핵심 타겟"
          value={core ? formatN(core.size) : "—"}
          hint={cohortModeHint(core)}
          isFallback={core?.mode === "percentile"}
        />
        <Stat
          label="타겟층"
          value={target ? formatN(target.size) : "—"}
          hint={cohortModeHint(target)}
          isFallback={target?.mode === "percentile"}
        />
      </div>
    </div>
  );
}

/** cohort cut mode를 짧은 라벨로 변환. 옛 이력(mode 필드 없음)은 표시 안 함. */
function cohortModeHint(
  c: { mode?: string; percentile?: number; threshold_absolute?: number } | undefined,
): { text: string; tone: "absolute" | "percentile" } | undefined {
  if (!c || c.mode === undefined) return undefined;
  if (c.mode === "absolute" && c.threshold_absolute !== undefined) {
    return { text: `점수 ≥${c.threshold_absolute.toFixed(0)}`, tone: "absolute" };
  }
  if (c.mode === "percentile" && c.percentile !== undefined) {
    return { text: `상위 ${c.percentile}% 폴백`, tone: "percentile" };
  }
  return undefined;
}

function Stat({
  label,
  value,
  hint,
  isFallback = false,
}: {
  label: string;
  value: string;
  hint?: { text: string; tone: "absolute" | "percentile" };
  /** percentile 폴백 cohort일 때 인원 숫자 대신 "기준 다름" 표기.
   * 절대 컷이 인원 부족으로 모집단 percentile로 떨어진 케이스는 A·B 간 직접 비교가
   * 부적합하므로(컷 기준이 달라짐) 큰 숫자를 보여주면 오인할 수 있다. */
  isFallback?: boolean;
}) {
  // 숫자+단위 분리 — "8.7만" → ["8.7", "만"], "1,234" → ["1,234", ""], "67.3" → ["67.3", ""]
  const { num, unit } = splitNumberUnit(value);
  return (
    <div>
      <p className="text-overline text-dusty leading-tight">{label}</p>
      {isFallback ? (
        <p
          className="mt-0.5 text-body-sm text-dusty italic"
          title="컷 기준이 달라 A·B 인원 직접 비교 부적합"
        >
          기준 다름
        </p>
      ) : (
        <p className="mt-0.5 leading-none flex items-baseline justify-center gap-0.5 truncate">
          <span className="text-heading font-semibold text-ink num-tabular tracking-tight">
            {num}
          </span>
          {unit && (
            <span className="text-caption text-dusty font-normal">{unit}</span>
          )}
        </p>
      )}
      {hint && (
        <p
          className={`text-overline mt-1 leading-tight num-tabular ${
            hint.tone === "absolute" ? "text-terra font-medium" : "text-dusty"
          }`}
          title={
            hint.tone === "percentile"
              ? "절대 컷(임계 점수↑) 인원이 부족해 모집단 상위 percentile로 폴백된 cohort"
              : "절대 점수 컷이 그대로 적용된 cohort"
          }
        >
          {hint.text}
        </p>
      )}
    </div>
  );
}

function formatN(n: number): string {
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString();
}

/** "8.7만" → {num:"8.7", unit:"만"}, "1,234" → {num:"1,234", unit:""}, "—" → {num:"—", unit:""} */
function splitNumberUnit(value: string): { num: string; unit: string } {
  const match = value.match(/^([0-9.,]+)([^0-9.,]+)$/);
  if (match) return { num: match[1], unit: match[2] };
  return { num: value, unit: "" };
}

// ============================================================
// 좌우 결과 카드
// ============================================================

function VariantSummaryCard({
  variant,
  accent,
  isBaseline,
  challengerKind,
  inputMode,
}: {
  variant: ABVariantResult;
  accent: "A" | "B";
  isBaseline: boolean;
  challengerKind: ABChallengerKind;
  inputMode: ABTestInputMode;
}) {
  const { label, selling_points, top_personas, top_opinions, province_stats } = variant;
  const isMarketing = inputMode === "marketing";
  // 기준안일 때는 ink(진한 색)으로 강조, 아니면 accent 컬러
  const accentClass = isBaseline
    ? "border-l-ink"
    : accent === "A"
      ? "border-l-azure"
      : "border-l-terra";

  return (
    <section
      className={`border border-parchment border-l-4 ${accentClass} rounded-[9.6px] bg-vellum overflow-hidden`}
    >
      <header className="bg-snow border-b border-parchment px-4 py-3">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span
            className={`inline-flex items-center justify-center w-6 h-6 rounded-[5px] text-caption font-bold
                        ${accent === "A" ? "bg-azure/30 text-ink" : "bg-terra/20 text-terra"}`}
          >
            {accent}
          </span>
          <h3 className="text-title text-ink truncate" title={label}>
            {label}
          </h3>
          {isBaseline ? (
            <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-[5px] bg-ink text-vellum text-overline font-semibold">
              당사 안 (기준)
            </span>
          ) : (
            <span
              className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-[5px] text-overline font-medium border
                          ${
                            challengerKind === "internal"
                              ? "bg-snow text-graphite border-parchment"
                              : "bg-terra/10 text-terra border-terra/30"
                          }`}
            >
              {challengerKind === "internal" ? "도전안 — 당사 다른 상품" : "도전안 — 타사 상품"}
            </span>
          )}
        </div>
        <p className="text-body-sm text-dusty">{selling_points.summary}</p>
      </header>

      <div className="px-4 py-3 sm:px-5 sm:py-4 space-y-4">
        {/* 핵심 혜택 — 카피 모드에서는 옛 이력에 추론값이 남아 있어도 무조건 숨김 */}
        {!isMarketing && selling_points.key_benefits.length > 0 && (
          <div>
            <p className="text-overline text-graphite mb-1.5">핵심 혜택</p>
            <ul className="space-y-1 text-body-sm text-graphite">
              {selling_points.key_benefits.slice(0, 5).map((b, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="text-terra shrink-0">•</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 핵심 타겟 페르소나 Top 5 */}
        {top_personas.length > 0 && (
          <div>
            <p className="text-overline text-graphite mb-1.5">핵심 타겟 페르소나</p>
            <ul className="space-y-1.5">
              {top_personas.slice(0, 5).map((p) => (
                <PersonaRow key={p.uuid} p={p} />
              ))}
            </ul>
          </div>
        )}

        {/* 의견 샘플 3건 */}
        {top_opinions.length > 0 && (
          <div>
            <p className="text-overline text-graphite mb-1.5">
              {isMarketing ? "카피 인상 샘플" : "의견 샘플"}
            </p>
            <ul className="space-y-2">
              {top_opinions.slice(0, 3).map((o) => (
                <OpinionRow key={o.persona_uuid} o={o} inputMode={inputMode} />
              ))}
            </ul>
          </div>
        )}

        {/* 시도 Top 5 */}
        {province_stats.length > 0 && (
          <div>
            <p className="text-overline text-graphite mb-1.5">우세 시도 Top 5</p>
            <ul className="flex flex-wrap gap-1.5">
              {province_stats.slice(0, 5).map((r) => (
                <li
                  key={r.name}
                  className="inline-flex items-center gap-1 rounded-[7px] bg-snow border border-parchment px-2 py-1 text-caption text-graphite"
                >
                  <span className="text-ink font-medium">{r.name}</span>
                  <span className="text-dusty">
                    · {Math.round((r.count / province_stats.reduce((s, x) => s + x.count, 0)) * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function PersonaRow({ p }: { p: PersonaHit }) {
  return (
    <li className="flex items-center justify-between gap-2 text-body-sm">
      <span className="text-graphite truncate">
        <span className="text-ink font-medium">
          {p.sex} {p.age}세
        </span>{" "}
        · {p.province} · {p.occupation}
      </span>
      <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-[5px] bg-snow text-caption text-ink font-medium border border-parchment">
        {p.score.toFixed(0)}
      </span>
    </li>
  );
}

function OpinionRow({
  o,
  inputMode,
}: {
  o: PersonaOpinion;
  inputMode: ABTestInputMode;
}) {
  // 한화 톤 매핑 — 긍정=azure(보조 강조), 부정=terra(주의 액센트), 중립=parchment.
  // ChallengerKindBadge/RecommendationBadge의 internal=azure / external=terra 패턴과 일관.
  const sentimentColor =
    o.sentiment === "긍정"
      ? "text-ink bg-azure/25 border-azure/40"
      : o.sentiment === "부정"
        ? "text-terra bg-terra/10 border-terra/30"
        : "text-graphite bg-snow border-parchment";
  // 카피 입력일 때는 가입의향 → 관심도(이 카피를 본 후 알아볼 의향). 약관·컨셉은 그대로.
  const intentLabel = inputMode === "marketing" ? "관심도" : "가입의향";
  return (
    <li className="rounded-[7px] border border-parchment bg-snow/40 p-2.5">
      <div className="flex items-center gap-2 mb-1">
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-[5px] text-caption font-medium border ${sentimentColor}`}>
          {o.sentiment}
        </span>
        <span className="text-caption text-dusty">
          {intentLabel} {o.purchase_intent}/5
        </span>
      </div>
      <p className="text-body-sm text-graphite leading-6">&ldquo;{o.opinion_text}&rdquo;</p>
    </li>
  );
}

// ============================================================
// 마크다운 섹션 (당사 장단점 / FP 전략 공통)
// ============================================================

function MarkdownSection({
  title,
  subtitle,
  markdown,
  accent = "ink",
}: {
  title: string;
  subtitle: string;
  markdown: string;
  accent?: "ink" | "terra";
}) {
  const accentClass = accent === "terra" ? "border-l-terra" : "border-l-ink";
  const normalized = unwrapMarkdownFence(markdown);

  return (
    <section className={`border border-parchment border-l-4 ${accentClass} rounded-[9.6px] bg-vellum overflow-hidden`}>
      <header className="bg-snow border-b border-parchment px-4 py-3 sm:px-5 sm:py-4">
        <h2 className="text-title text-ink">{title}</h2>
        <p className="text-body-sm text-dusty mt-1">{subtitle}</p>
      </header>
      <div className="px-4 py-4 sm:px-5 sm:py-5">
        <div className={PROSE_CLASS}>
          <ReactMarkdown>{normalized}</ReactMarkdown>
        </div>
      </div>
    </section>
  );
}

function unwrapMarkdownFence(markdown: string): string {
  const trimmed = (markdown ?? "").trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return match ? match[1].trim() : trimmed;
}
