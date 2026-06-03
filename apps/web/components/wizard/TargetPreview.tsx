"use client";

import { ADDITIONAL_FILTER_LABELS, type ExtractedFilter } from "@/lib/api";

/**
 * 대상자 미리보기 우측 패널 구성요소 — AI 자동 추출 칩 + 분포 미니 차트.
 * StepTargets(컨테이너)가 SubCard 안에 배치한다.
 */

export function ExtractedChips({ ex }: { ex: ExtractedFilter }) {
  const chips: { label: string; value: string }[] = [];
  if (ex.sex.length) chips.push({ label: "성별", value: ex.sex.join(", ") });
  if (ex.age_min !== null && ex.age_max !== null) {
    chips.push({ label: "연령", value: `${ex.age_min}-${ex.age_max}세` });
  }
  if (ex.provinces.length) {
    chips.push({
      label: "지역",
      value: ex.provinces.length > 3
        ? `${ex.provinces.slice(0, 3).join(", ")} 외 ${ex.provinces.length - 3}`
        : ex.provinces.join(", "),
    });
  }
  if (ex.marital_statuses.length) {
    chips.push({ label: "혼인", value: ex.marital_statuses.join(", ") });
  }
  if (ex.has_children === true) chips.push({ label: "가구", value: "자녀 양육 중" });
  else if (ex.has_children === false) chips.push({ label: "가구", value: "자녀 없음" });
  if (ex.employment_status === "employed") chips.push({ label: "고용", value: "직장인" });
  else if (ex.employment_status === "unemployed") chips.push({ label: "고용", value: "무직" });
  if (ex.occupations.length) chips.push({ label: "직업", value: ex.occupations.join(", ") });
  for (const [col, vals] of Object.entries(ex.additional_filters || {})) {
    if (!vals?.length) continue;
    const label = ADDITIONAL_FILTER_LABELS[col] ?? col;
    chips.push({
      label,
      value: vals.length > 3 ? `${vals.slice(0, 3).join(", ")} 외 ${vals.length - 3}` : vals.join(", "),
    });
  }
  if (chips.length === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap gap-1.5 pb-3 border-b border-parchment">
      <span className="text-overline text-dusty mr-1">AI 자동 추출</span>
      {chips.map((c) => (
        <span
          key={`${c.label}-${c.value}`}
          className="inline-flex items-center gap-1 text-caption px-2 py-0.5 bg-vellum border border-terra/40 text-graphite rounded-full"
        >
          <span className="text-dusty">{c.label}</span>
          <span className="text-ink font-medium">{c.value}</span>
        </span>
      ))}
    </div>
  );
}

export function MiniDistribution({
  dist,
  total,
}: {
  dist: { sex: Record<string, number>; age_bins: { label: string; count: number }[]; province: Record<string, number> };
  total: number;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <DistBlock title="성별" entries={Object.entries(dist.sex)} total={total} />
      <DistBlock
        title="연령대"
        entries={dist.age_bins.map((b) => [b.label, b.count] as [string, number])}
        total={total}
        maxRows={4}
      />
      <DistBlock
        title="시도 Top 5"
        entries={Object.entries(dist.province)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)}
        total={total}
      />
    </div>
  );
}

function DistBlock({
  title,
  entries,
  total,
  maxRows = 6,
}: {
  title: string;
  entries: [string, number][];
  total: number;
  maxRows?: number;
}) {
  const max = entries.reduce((m, [, v]) => Math.max(m, v), 0);
  const top = entries.slice(0, maxRows);
  return (
    <div className="bg-vellum border border-parchment rounded-[9.6px] px-3 py-2">
      <p className="text-overline text-dusty mb-1.5">{title}</p>
      <ul className="space-y-1">
        {top.length === 0 && <li className="text-caption text-stone">—</li>}
        {top.map(([k, v]) => {
          const pct = total ? (v / total) * 100 : 0;
          const bar = max ? (v / max) * 100 : 0;
          return (
            <li key={k}>
              <div className="flex items-baseline justify-between gap-2 text-caption mb-0.5">
                <span className="text-graphite truncate">{k}</span>
                <span className="text-ink font-mono tabular-nums shrink-0">
                  {v.toLocaleString()}
                  <span className="text-dusty ml-1">({pct.toFixed(1)}%)</span>
                </span>
              </div>
              <div className="h-1 bg-parchment rounded-full overflow-hidden">
                <div className="h-full bg-terra/80" style={{ width: `${bar}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
