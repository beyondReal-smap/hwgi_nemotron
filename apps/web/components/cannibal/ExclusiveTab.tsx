"use client";

import { useState } from "react";
import { DemographicCard } from "@/components/DistributionCharts";
import { KoreaMap } from "@/components/KoreaMap";
import type { CannibalResponse } from "@/lib/api";

/**
 * 전용층 프로파일러 — 오직 한 안에만 반응한 고유층(setdiff)의 인구통계·지역 분포.
 * 안 선택 칩 → 해당 ExclusiveProfile 렌더. DemographicCard·KoreaMap 재사용.
 */
export function ExclusiveTab({ data }: { data: CannibalResponse }) {
  const profiles = data.exclusive_profiles ?? [];
  const [sel, setSel] = useState(0);
  if (profiles.length === 0) {
    return (
      <div className="rounded-[9.6px] border border-parchment bg-snow/40 p-6 text-body-sm text-dusty text-center">
        전용층 데이터가 없습니다.
      </div>
    );
  }

  const p = profiles[Math.min(sel, profiles.length - 1)];
  const pct = Math.round(p.exclusive_ratio * 100);
  const small = p.exclusive_size < 500;

  return (
    <section className="space-y-4">
      {/* 안 선택 칩 */}
      <div className="flex flex-wrap gap-2">
        {profiles.map((pr, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setSel(i)}
            className={`px-3 py-1.5 rounded-[7px] text-body-sm font-medium border transition-colors
                        ${
                          i === sel
                            ? "bg-ink text-vellum border-ink"
                            : "bg-vellum text-graphite border-parchment hover:bg-snow"
                        }`}
          >
            {pr.label}
          </button>
        ))}
      </div>

      {/* 요약 + 비율 배지 */}
      <div className="rounded-[9.6px] border border-parchment bg-snow/40 p-4">
        <p className="text-body text-ink">
          <span className="font-semibold">{p.label}</span> 전용층:{" "}
          <span className="num-tabular font-semibold">
            {p.exclusive_size.toLocaleString()}명
          </span>
          <span className="text-dusty"> (전체 코호트의 {pct}%만 고유)</span>
        </p>
        <p className="text-caption text-dusty mt-1">
          오직 이 안에만 반응한 고객층 — 다른 안과 겹치지 않습니다. {pct}%가 낮으면
          대부분 다른 안과 공유되는 층입니다. (전용층 규모는 안의 매력도에 종속되니
          비율로 비교하세요.)
        </p>
        {small && (
          <p className="text-caption text-warning font-medium mt-1.5">
            ⚠️ 전용층이 500명 미만이라 아래 분포는 통계적으로 불안정할 수 있습니다.
          </p>
        )}
      </div>

      {/* 인구통계 카드 그리드 — 병역(military_status)은 제외 (분석·A/B 결과 패널과 동일 정책) */}
      {p.demographics.some((dem) => dem.column !== "military_status") && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {p.demographics
            .filter((dem) => dem.column !== "military_status")
            .map((dem) => (
              <DemographicCard key={dem.column} dem={dem} />
            ))}
        </div>
      )}

      {/* 시군구 지도 */}
      {p.districts.length > 0 && (
        <KoreaMap
          districts={p.districts}
          title={`${p.label} 전용층 — 시군구 분포`}
        />
      )}
    </section>
  );
}
