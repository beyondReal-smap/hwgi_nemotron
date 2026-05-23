"use client";

import type {
  CohortStat,
  DemographicGroup,
  DistributionBin,
  PopulationStats,
} from "@/lib/api";

type Props = {
  stats: PopulationStats;
};

export function PopulationStatsPanel({ stats }: Props) {
  return (
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
      <header className="bg-snow border-b border-parchment border-l-4 border-l-terra px-4 py-3 sm:px-5 sm:py-4">
        <h2 className="text-title text-ink">📊 전국 모집단 통계</h2>
        <p className="text-body-sm text-dusty mt-1">
          전체 {stats.total_scored.toLocaleString()}명의 페르소나를 스코어링하여
          산출한 인구통계 분포 (Nemotron 카테고리형 컬럼 전체)
        </p>
      </header>

      <CohortStrip cohorts={stats.cohorts} totalScored={stats.total_scored} />

      <ScoreDistributionBar
        bins={stats.score_distribution}
        cohorts={stats.cohorts}
      />

      <div className="border-t border-parchment p-4 sm:p-5">
        <h3 className="text-heading text-ink mb-1">
          인구통계 분포
        </h3>
        <p className="text-body-sm text-dusty mb-4">
          타겟층({stats.cohorts.find((c) => c.name === "target")?.size.toLocaleString()}명)
          기준 — 점수 ≥{" "}
          {stats.cohorts.find((c) => c.name === "target")?.min_score.toFixed(1)}
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {stats.demographics.map((g) => (
            <DemographicCard key={g.column} group={g} />
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// Cohort 요약 띠
// ============================================================

function CohortStrip({
  cohorts,
  totalScored,
}: {
  cohorts: CohortStat[];
  totalScored: number;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-parchment">
      {cohorts.map((c) => (
        <div key={c.name} className="px-4 py-3 sm:px-5 sm:py-4">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-body font-semibold text-ink">{c.label}</p>
            <p className="text-caption text-dusty num-tabular">
              상위 {c.percentile}%
            </p>
          </div>
          <p className="text-title font-semibold text-ink num-tabular mt-1.5">
            {c.size.toLocaleString()}
            <span className="text-body-sm font-normal text-dusty ml-1">명</span>
          </p>
          <p className="text-caption text-stone num-tabular mt-1.5">
            점수 ≥ {c.min_score.toFixed(1)} · 평균 {c.avg_score.toFixed(1)} ·{" "}
            전체의 {((c.size / totalScored) * 100).toFixed(1)}%
          </p>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// 점수 히스토그램
// ============================================================

function ScoreDistributionBar({
  bins,
  cohorts,
}: {
  bins: DistributionBin[];
  cohorts: CohortStat[];
}) {
  if (bins.length === 0) return null;

  const max = Math.max(...bins.map((b) => b.count));
  const coreMin = cohorts.find((c) => c.name === "core")?.min_score ?? 100;
  const targetMin = cohorts.find((c) => c.name === "target")?.min_score ?? 100;
  const interestMin = cohorts.find((c) => c.name === "interest")?.min_score ?? 0;

  return (
    <div className="border-t border-parchment px-4 py-3 sm:px-5 sm:py-4">
      <h3 className="text-heading text-ink mb-1">점수 분포</h3>
      <p className="text-body-sm text-dusty mb-3">
        관심층(상위 20%) 기준 5점 단위 빈도. 막대 색상은 cohort 표시.
      </p>
      <div
        className="flex items-end gap-1 h-28"
        role="img"
        aria-label="점수 히스토그램"
      >
        {bins.map((b) => {
          const binStart = Number(b.label.split("~")[0]);
          const isCore = binStart >= coreMin;
          const isTarget = !isCore && binStart >= targetMin;
          const bg = isCore
            ? "bg-terra"
            : isTarget
              ? "bg-azure"
              : "bg-parchment";
          const height = max > 0 ? (b.count / max) * 100 : 0;
          return (
            <div
              key={b.label}
              className={`flex-1 ${bg} rounded-t-[2px] transition-all`}
              style={{
                height: `${height}%`,
                minHeight: b.count > 0 ? "2px" : "0",
              }}
              title={`${b.label}점: ${b.count.toLocaleString()}명`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-caption text-stone mt-1.5 num-tabular">
        <span>{bins[0]?.label.split("~")[0]}점</span>
        <span>{bins[bins.length - 1]?.label.split("~")[1]}점</span>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-body-sm text-dusty mt-2.5">
        <Legend color="bg-terra" label={`핵심 (≥${coreMin.toFixed(0)})`} />
        <Legend color="bg-azure" label={`타겟 (≥${targetMin.toFixed(0)})`} />
        <Legend
          color="bg-parchment"
          label={`관심 (≥${interestMin.toFixed(0)})`}
        />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className={`inline-block w-2.5 h-2.5 rounded-sm ${color}`} />
      <span>{label}</span>
    </div>
  );
}

// ============================================================
// 인구통계 분포 카드 (컬럼 1개당)
// ============================================================

function DemographicCard({ group }: { group: DemographicGroup }) {
  if (group.bins.length === 0) return null;

  const totalCount = group.bins.reduce((acc, b) => acc + b.count, 0);
  const max = Math.max(...group.bins.map((b) => b.count));

  return (
    <article className="border border-parchment rounded-[9.6px] p-3 sm:p-4 bg-vellum">
      <header className="flex items-baseline justify-between gap-2 mb-3">
        <h4 className="text-heading text-ink truncate">{group.label}</h4>
        <p className="text-caption text-stone num-tabular shrink-0">
          {group.truncated_to
            ? `Top ${group.truncated_to} / ${group.total_unique}`
            : `${group.total_unique}개 분류`}
        </p>
      </header>

      <ul className="space-y-2">
        {group.bins.map((b) => {
          const widthPct = max > 0 ? (b.count / max) * 100 : 0;
          const sharePct = totalCount > 0 ? (b.count / totalCount) * 100 : 0;
          return (
            <li
              key={b.label}
              className="grid grid-cols-[minmax(0,38%)_minmax(0,1fr)_auto_auto] sm:grid-cols-[minmax(0,32%)_minmax(0,1fr)_62px_44px] items-center gap-1.5 sm:gap-2"
            >
              <span
                className="text-body-sm text-graphite truncate"
                title={b.label}
              >
                {b.label}
              </span>
              <div className="h-4 bg-snow rounded-[2px] relative overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-ink/70 rounded-[2px]"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
              <span className="text-body-sm font-mono text-graphite num-tabular text-right tabular-nums">
                {b.count.toLocaleString()}
              </span>
              <span className="text-caption text-stone num-tabular text-right tabular-nums">
                {sharePct.toFixed(1)}%
              </span>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
