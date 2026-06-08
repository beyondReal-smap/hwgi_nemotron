"use client";

import { useMemo, useState } from "react";
import type { RegionStat } from "@/lib/api";

type Props = {
  districts: RegionStat[];
  topN?: number;
};

// 농도(per-capita) 모드에서 분모 아티팩트를 막기 위한 최소 모집단 인원 (KoreaMap과 동일 정책)
const MIN_POP_DENSITY = 300;

export function DistrictTopTable({ districts, topN = 10 }: Props) {
  const [mode, setMode] = useState<"count" | "density">("count");

  // 농도 가능한 시군구(모집단 표본 충분 + lift 존재)
  const densityRows = useMemo(
    () =>
      districts
        .filter(
          (d) =>
            d.lift_ratio != null &&
            d.population_count != null &&
            d.population_count >= MIN_POP_DENSITY,
        )
        .sort((a, b) => (b.lift_ratio as number) - (a.lift_ratio as number)),
    [districts],
  );
  const hasLift = densityRows.length > 0;
  const effectiveMode = hasLift ? mode : "count";

  const totalCount = districts.reduce((s, d) => s + d.count, 0);

  // 인원 모드: 백엔드가 이미 count 내림차순 → 그대로. 농도 모드: lift 내림차순.
  const rows =
    effectiveMode === "density" ? densityRows.slice(0, topN) : districts.slice(0, topN);
  if (rows.length === 0) return null;

  const maxCount = districts[0]?.count ?? 0;
  const maxLift = densityRows[0]?.lift_ratio ?? 0;

  return (
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
      <header className="bg-snow border-b border-parchment px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-title text-ink">
            Top {rows.length} 공략 시군구
          </h2>
          <p className="text-body-sm text-dusty num-tabular">
            타겟층 {totalCount.toLocaleString()}명 기준
          </p>
        </div>
        {hasLift && (
          <div
            className="mt-2.5 inline-flex rounded-[9.6px] border border-parchment bg-vellum p-0.5"
            role="tablist"
            aria-label="공략 시군구 정렬 기준"
          >
            <Tab
              active={effectiveMode === "count"}
              onClick={() => setMode("count")}
              label="인원순"
            />
            <Tab
              active={effectiveMode === "density"}
              onClick={() => setMode("density")}
              label="농도순"
            />
          </div>
        )}
        <p className="text-body-sm text-dusty mt-2">
          {effectiveMode === "density"
            ? "인구 대비 반응 농도(전국 평균 대비 배수)가 높은 순. 인구 자체가 적어도 진하게 반응하는 숨은 핫스팟을 드러냅니다."
            : "반응 페르소나가 가장 많이 분포한 행정구역. 영업·마케팅 집중 후보."}
        </p>
      </header>

      <ol
        className="divide-y divide-parchment"
        aria-label={`Top ${rows.length} 공략 시군구 목록`}
      >
        {rows.map((d, idx) => {
          const sharePct = totalCount > 0 ? (d.count / totalCount) * 100 : 0;
          const isDensity = effectiveMode === "density";
          const lift = d.lift_ratio ?? 0;
          const widthPct = isDensity
            ? maxLift > 0
              ? (lift / maxLift) * 100
              : 0
            : maxCount > 0
              ? (d.count / maxCount) * 100
              : 0;
          return (
            <li
              key={d.name}
              className="px-4 py-3 sm:px-5 grid grid-cols-[1.75rem_minmax(0,1fr)_auto] sm:grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 sm:gap-3"
            >
              <span className="text-body-sm font-mono text-dusty num-tabular">
                #{idx + 1}
              </span>
              <div className="min-w-0">
                <p className="text-body font-semibold text-ink truncate">
                  {d.name}
                </p>
                <div
                  className="mt-1.5 h-1.5 bg-snow rounded-[2px] relative overflow-hidden"
                  title={
                    isDensity
                      ? `${d.name}: 인구 대비 ×${lift.toFixed(2)} 농도`
                      : `${d.name}: ${d.count.toLocaleString()}명 (${sharePct.toFixed(1)}%)`
                  }
                >
                  <div
                    className="absolute inset-y-0 left-0 bg-terra/70 rounded-[2px]"
                    style={{ width: `${widthPct}%` }}
                  />
                  <span className="sr-only">
                    {isDensity ? `농도 ×${lift.toFixed(1)}` : `${sharePct.toFixed(1)}%`}
                  </span>
                </div>
              </div>
              <div className="text-right num-tabular shrink-0">
                {isDensity ? (
                  <>
                    <p className="text-body font-semibold text-terra">
                      ×{lift.toFixed(1)}
                      <span className="text-caption text-dusty font-normal ml-1">
                        농도
                      </span>
                    </p>
                    <p className="text-caption text-dusty">
                      타겟 {d.count.toLocaleString()}명
                      {d.population_count != null
                        ? ` / 모집단 ${d.population_count.toLocaleString()}`
                        : ""}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-body font-semibold text-ink">
                      {d.count.toLocaleString()}
                      <span className="text-caption text-dusty font-normal ml-1">
                        명
                      </span>
                    </p>
                    <p className="text-caption text-dusty">
                      {sharePct.toFixed(1)}% · 평균 {d.avg_score.toFixed(1)}
                    </p>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Tab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`px-3 py-1 rounded-[7px] text-body-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-azure ${
        active ? "bg-terra text-snow shadow-sm" : "text-graphite hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}
