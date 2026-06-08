"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import { normalizeMarkdown } from "@/lib/markdown";
import type {
  ABChallengerKind,
  ABOverlap,
  ABTestInputMode,
  ABTestResponse,
  ABVariantResult,
  PersonaHit,
  PersonaOpinion,
} from "@/lib/api";
import { ComparisonTable } from "./ComparisonTable";
import { CategoryDivergence } from "./CategoryDivergence";
import { OverlapVenn } from "./OverlapVenn";
import { SwingLayerXray } from "./SwingLayerXray";
import { SplitPlaybook } from "./SplitPlaybook";
import { DemographicCard } from "@/components/DistributionCharts";
import { SentimentBadge } from "@/components/SentimentBadge";
import type { ComparisonRow as ComparisonRowType } from "@/lib/api";

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
        overlap={comparison.overlap}
        winTally={comparison.win_tally}
        rows={comparison.summary_table}
      />

      {/* 분기 운영 처방전 — split 추천 시 'A로 팔 사람/B로 팔 사람' (비-split이면 자동 스킵) */}
      <SplitPlaybook
        rules={comparison.split_playbook}
        labelA={variant_a.label}
        labelB={variant_b.label}
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

      {/* 카테고리 성향 차이 — 버려지던 category_diff 시각화(빈 객체/전부 0이면 자동 스킵) */}
      <CategoryDivergence
        categoryDiff={comparison.category_diff}
        labelA={variant_a.label}
        labelB={variant_b.label}
      />

      {/* 반응 겹침 — 벤+막대(직관 시각화) */}
      {comparison.overlap && (
        <OverlapVenn
          overlap={comparison.overlap}
          labelA={variant_a.label}
          labelB={variant_b.label}
        />
      )}

      {/* 스윙층 X-레이 — 교집합/전용층 demographics + 줄다리기(데이터 없으면 자동 스킵) */}
      <SwingLayerXray
        segments={comparison.overlap_segments}
        swingPull={comparison.swing_pull}
        labelA={variant_a.label}
        labelB={variant_b.label}
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
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
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
    // A·B 카드를 배경색으로 대비 (A: marine 톤, B: terra 톤 — 헤더 배지와 일관)
    <div className={`p-4 ${accent === "A" ? "bg-marine/[0.07]" : "bg-terra/[0.05]"}`}>
      <h3 className="flex items-center gap-2 text-heading text-ink mb-3">
        <span
          className={`inline-flex items-center justify-center w-5 h-5 rounded-[5px] text-overline font-semibold
            ${accent === "A" ? "bg-marine/20 text-marine" : "bg-terra/20 text-terra"}`}
        >
          {accent}
        </span>
        <span className="truncate" title={variant.label}>
          {variant.label}
        </span>
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {variant.population_stats.demographics
          // 병역(military_status)은 A/B 비교에서 제외
          .filter((g) => g.column !== "military_status")
          .map((g) => (
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
  overlap,
  winTally,
  rows,
}: {
  recommended: "A" | "B" | "split";
  baseline: "A" | "B";
  challengerKind: ABChallengerKind;
  a: ABVariantResult;
  b: ABVariantResult;
  overlap?: ABOverlap | null;
  winTally?: { a: number; b: number; tie: number } | null;
  rows: ComparisonRowType[];
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

  // 반응층 겹침(잠식 신호) — split/통합 추천의 정량 근거. 의미 유사도 기반 신호.
  const overlapPct = overlap ? Math.round(overlap.jaccard * 100) : 0;
  const overlapNote = !overlap
    ? null
    : overlap.relation === "complementary"
      ? {
          icon: "🧩",
          text: `반응층 겹침이 낮습니다(Jaccard ${overlapPct}%) — 서로 다른 고객층이라 분기 운영 시 시장이 확장됩니다.`,
        }
      : overlap.relation === "cannibal"
        ? {
            icon: "⚠️",
            text: `두 안이 같은 반응층을 노립니다(Jaccard ${overlapPct}%) — 동시 운영 시 잠식 우려가 있어 하나로 통합하는 편이 효율적입니다.`,
          }
        : {
            icon: "◐",
            text: `반응층이 부분적으로 겹칩니다(Jaccard ${overlapPct}%).`,
          };

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
          {overlapNote && (
            <p className="text-caption text-dusty mt-1.5 flex items-start gap-1">
              <span aria-hidden>{overlapNote.icon}</span>
              <span>{overlapNote.text}</span>
            </p>
          )}
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

      {/* 승부 스코어보드 — 핵심 5개 지표 집계(win_tally) + 지표별 승패 도트. 구 이력(undefined)은 숨김. */}
      {winTally && (
        <WinScoreboard tally={winTally} labelA={a.label} labelB={b.label} rows={rows} />
      )}
    </section>
  );
}

/**
 * 승부 스코어보드 — 핵심 5개 수치 지표(win_tally)에서 A·B 승수를 집계해
 * 추천이 '데이터로 이긴 판정'임을 가시화. 우세 승차로 확신도 게이지를 표기.
 */
// 승부 스코어보드의 도트로 표기할 핵심 5개 지표(win_tally 집계 대상과 동일).
const _SCOREBOARD_METRICS: { key: string; label: string }[] = [
  { key: "avg_score", label: "평균점수" },
  { key: "core_size", label: "핵심규모" },
  { key: "target_size", label: "타겟규모" },
  { key: "avg_intent", label: "가입의향" },
  { key: "positive_ratio", label: "긍정비율" },
];

function WinScoreboard({
  tally,
  labelA,
  labelB,
  rows,
}: {
  tally: { a: number; b: number; tie: number };
  labelA: string;
  labelB: string;
  rows: ComparisonRowType[];
}) {
  const { a, b, tie } = tally;
  // 지표별 승자 — 게이지(합산)가 못 드러내는 '어느 지표에서 이겼나'를 도트로 분해.
  const metricWinner = (key: string): "A" | "B" | "tie" =>
    rows.find((r) => r.key === key)?.winner ?? "tie";
  const margin = Math.abs(a - b);
  // 확신도: 승차 3+ = 명확한 우위, 1~2 = 근소 우위, 0 = 분기.
  const confidence =
    margin >= 3 ? "명확한 우위" : margin >= 1 ? "근소 우위" : "분기 (우열 불분명)";
  // 우세측 색 — A=marine, B=terra, 동률/분기=azure.
  const leader = a > b ? "A" : b > a ? "B" : "tie";
  const leaderTone =
    leader === "A" ? "text-marine" : leader === "B" ? "text-terra" : "text-ink";
  const gaugeColor =
    leader === "A"
      ? "bg-marine"
      : leader === "B"
        ? "bg-terra"
        : "bg-azure";
  // 게이지 채움 — 승차 0~3+ 을 0~100%로(3 이상은 가득).
  const gaugePct = Math.min(100, (margin / 3) * 100);

  return (
    <div className="mt-4 rounded-[7px] border border-parchment bg-vellum p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
        <p className="text-overline text-graphite">승부 스코어보드</p>
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-[5px] text-overline font-semibold border ${
            leader === "A"
              ? "bg-marine/15 text-marine border-marine/30"
              : leader === "B"
                ? "bg-terra/15 text-terra border-terra/30"
                : "bg-azure/25 text-ink border-azure/40"
          }`}
        >
          {confidence}
        </span>
      </div>

      {/* 점수 — A : B (무승부) */}
      <p className="text-body-sm text-graphite mb-2">
        핵심 5개 지표 중{" "}
        <span className="text-marine font-semibold num-tabular" title={labelA}>
          A {a}
        </span>{" "}
        :{" "}
        <span className="text-terra font-semibold num-tabular" title={labelB}>
          B {b}
        </span>
        {tie > 0 && (
          <span className="text-dusty">
            {" "}
            (무승부 <span className="num-tabular">{tie}</span>)
          </span>
        )}
      </p>

      {/* 확신 게이지 — 우세 승차를 폭으로 */}
      <div
        className="h-2 rounded-full bg-snow border border-parchment overflow-hidden"
        role="img"
        aria-label={`A ${a} 대 B ${b}, 무승부 ${tie}. ${confidence}`}
      >
        <div
          className={`h-full rounded-full transition-[width] ${gaugeColor}`}
          style={{ width: `${Math.max(leader === "tie" ? 0 : 8, gaugePct)}%`, opacity: 0.78 }}
        />
      </div>
      <p className={`text-overline mt-1.5 ${leaderTone}`}>
        {leader === "tie"
          ? "양측이 팽팽합니다 — 단일 우위보다 타겟별 분기 검토가 적합합니다."
          : `${leader === "A" ? labelA : labelB}가 ${margin}개 지표 앞섭니다.`}
      </p>

      {/* 지표별 승패 도트 — 합산 게이지가 못 보여주는 '어느 지표에서 갈렸나'를 분해 */}
      <div className="mt-3 pt-2.5 border-t border-parchment flex flex-wrap gap-x-3 gap-y-1.5">
        {_SCOREBOARD_METRICS.map((m) => {
          const w = metricWinner(m.key);
          return (
            <span
              key={m.key}
              className="inline-flex items-center gap-1 text-overline text-graphite"
              title={`${m.label}: ${w === "A" ? labelA : w === "B" ? labelB : "무승부"}`}
            >
              <span
                aria-hidden
                className={`w-2 h-2 rounded-full ${
                  w === "A" ? "bg-marine" : w === "B" ? "bg-terra" : "bg-dusty/40"
                }`}
              />
              {m.label}
              <span
                className={`font-semibold num-tabular ${
                  w === "A" ? "text-marine" : w === "B" ? "text-terra" : "text-dusty"
                }`}
              >
                {w === "tie" ? "—" : w}
              </span>
            </span>
          );
        })}
      </div>
    </div>
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
                      ? "bg-marine/20 text-marine border-marine/30"
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

  // 기준안은 좌측 강조선 대신 살짝 밝은 배경으로 구분 ("당사 안" 배지가 색을 보강)
  const cardClass = isBaseline ? "bg-snow/60" : "bg-vellum";

  return (
    <div className={`rounded-[7px] border border-parchment ${cardClass} p-3`}>
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`inline-flex items-center justify-center w-6 h-6 rounded-[5px] text-caption font-bold
                      ${accent === "A" ? "bg-marine/20 text-marine" : "bg-terra/20 text-terra"}`}
        >
          {accent}
        </span>
        <span className="text-body-sm font-semibold text-ink truncate" title={variant.label}>
          {variant.label}
        </span>
        {isBaseline ? (
          <span
            className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-[5px] text-vellum text-overline font-semibold
                        ${accent === "A" ? "bg-marine" : "bg-terra"}`}
          >
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
  // A·B 구분은 헤더의 accent 배지로 표현 (좌측 강조선 제거)

  return (
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
      <header className="bg-snow border-b border-parchment px-4 py-3">
        <div className="flex items-center gap-2 mb-1.5 min-w-0">
          <span
            className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-[5px] text-caption font-bold
                        ${accent === "A" ? "bg-marine/20 text-marine" : "bg-terra/20 text-terra"}`}
          >
            {accent}
          </span>
          <h3 className="text-title text-ink truncate" title={label}>
            {label}
          </h3>
        </div>
        {/* 안 라벨(당사 안/도전안) — 상품명 길이와 무관하게 항상 별도 줄에 배치해 A·B 위치 일관 */}
        <div className="mb-1">
          {isBaseline ? (
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-[5px] text-vellum text-overline font-semibold
                          ${accent === "A" ? "bg-marine" : "bg-terra"}`}
            >
              당사 안 (기준)
            </span>
          ) : (
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-[5px] text-overline font-medium border
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
  // 감정 색은 SentimentBadge로 통일(긍정=success, 부정=danger, 중립=회색) — A/B 섹션색(marine/terra)과 분리.
  // 카피 입력일 때는 가입의향 → 관심도(이 카피를 본 후 알아볼 의향). 약관·컨셉은 그대로.
  const intentLabel = inputMode === "marketing" ? "관심도" : "가입의향";
  return (
    <li className="rounded-[7px] border border-parchment bg-snow/40 p-2.5">
      <div className="flex items-center gap-2 mb-1">
        <SentimentBadge sentiment={o.sentiment} size="sm" />
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

// markdown 문자열이 동일하면(분석 결과 고정) 부모 리렌더 시에도 ReactMarkdown 재파싱을
// 건너뛰도록 memo. 마크다운 파싱은 비용이 크고 결과는 불변이라 효과가 확실하다.
const MarkdownSection = memo(function MarkdownSection({
  title,
  subtitle,
  markdown,
}: {
  title: string;
  subtitle: string;
  markdown: string;
}) {
  const normalized = stripLatexArrows(normalizeMarkdown(markdown));

  return (
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
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
});

/**
 * LLM이 화살표를 LaTeX($\rightarrow$ 등)로 출력하는 경우 유니코드 기호로 치환.
 * react-markdown은 KaTeX 플러그인이 없어 LaTeX 원문이 그대로 노출되기 때문.
 * 앞뒤 `$`(인라인 수식 구분자)는 있어도 없어도 매칭.
 */
function stripLatexArrows(markdown: string): string {
  return markdown
    .replace(/\$?\\(?:long)?rightarrow\$?/g, "→")
    .replace(/\$?\\(?:long)?leftarrow\$?/g, "←")
    .replace(/\$?\\Rightarrow\$?/g, "⇒")
    .replace(/\$?\\Leftrightarrow\$?/g, "↔")
    .replace(/\$?\\to\b\$?/g, "→");
}
