"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  DemographicColumn,
  DistributionBin,
  ProvinceRow,
} from "@/lib/api";

/**
 * 현황(overview)과 탐색(personas) 페이지가 공유하는 분포 차트 컴포넌트.
 *
 * overview/page.tsx에 정의돼 있던 차트를 그대로 추출 — 두 페이지의 룩앤필 일관성 확보.
 * 시각 토큰(색상/폰트/spacing)은 추출 전과 동일하게 유지한다.
 */

// ============================================================
// 공통 헬퍼 — 차트 수치 라벨 포맷
// ============================================================

/** 큰 수치는 k 단위로 압축 (예: 123,456 → 123k, 1,234 → 1,234). 차트 라벨 가독성용. */
export function formatCompact(v: number): string {
  if (v >= 10000) return `${Math.round(v / 1000).toLocaleString()}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toLocaleString();
}

/** 비율 표시 (예: 32.4%). 도넛/막대의 비율 라벨용. */
export function formatPercent(count: number, total: number): string {
  if (!total) return "0%";
  return `${((count / total) * 100).toFixed(1)}%`;
}

/** Record<라벨, 수> → DemographicCard용 bins. count 내림차순, topN 지정 시 상위만.
 *  탐색·설문 등 분포가 Record 형태로 오는 곳에서 DemographicColumn.bins로 변환할 때 사용. */
export function recordToBins(
  counts: Record<string, number>,
  topN?: number,
): DistributionBin[] {
  const sorted = Object.entries(counts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
  return topN ? sorted.slice(0, topN) : sorted;
}

// 한화 토큰 기반 차트 팔레트.
// 1순위 terra(악센트) → 2순위 azure(보조 블루) → 그 이후 graphite→stone 단조 회색계로 강·약 그라데이션.
// 첫 두 자리에 채도 있는 색을 두어 4개 이상 항목에서도 1·2위가 즉시 구분되도록 함.
export const DONUT_COLORS = ["#d97757", "#ccdbe8", "#3d3d3a", "#73726c", "#9c9a92", "#dedcd1", "#1f1e1d"];

// ============================================================
// 시도 막대 — ProvinceRow(시군구 수·평균 연령·여성 비율 포함)용
// ============================================================

export function ProvinceBar({ rows }: { rows: ProvinceRow[] }) {
  return (
    <div className="p-3">
      <ResponsiveContainer width="100%" height={480}>
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 48, bottom: 4, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#dedcd1" />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: "#73726c", fontFamily: "SUITE" }}
            stroke="#dedcd1"
            tickFormatter={(v) => (v / 1000).toFixed(0) + "k"}
          />
          <YAxis
            type="category"
            dataKey="province"
            tick={{ fontSize: 11, fill: "#3d3d3a", fontFamily: "SUITE" }}
            stroke="#dedcd1"
            width={60}
          />
          <Tooltip
            cursor={{ fill: "rgba(217, 119, 87, 0.08)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null;
              const d = payload[0].payload as ProvinceRow;
              return (
                <div className="bg-snow border border-parchment rounded-[9.6px] p-2.5 text-caption">
                  <p className="font-medium text-ink mb-1">{d.province}</p>
                  <p className="text-graphite">
                    인원:{" "}
                    <span className="font-medium text-terra">
                      {d.count.toLocaleString()}명
                    </span>
                  </p>
                  <p className="text-graphite">시군구: {d.district_count}개</p>
                  <p className="text-graphite">
                    평균 {d.avg_age.toFixed(1)}세 · 여성{" "}
                    {(d.female_ratio * 100).toFixed(1)}%
                  </p>
                </div>
              );
            }}
          />
          <Bar dataKey="count" fill="#d97757" radius={[0, 4, 4, 0]}>
            <LabelList
              dataKey="count"
              position="right"
              fill="#3d3d3a"
              fontSize={11}
              fontFamily="SUITE"
              formatter={(v) => formatCompact(Number(v ?? 0))}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ============================================================
// 인구통계 카드 — 항목 ≤4면 도넛, >4면 가로 막대 (자체 헤더 포함 카드)
// ============================================================

export function DemographicCard({
  dem,
  ageData,
}: {
  dem: DemographicColumn;
  ageData?: { mean: number; median: number };
}) {
  const useDonut = dem.bins.length <= 4;
  const total = dem.bins.reduce((s, b) => s + b.count, 0);

  const isAge = dem.column === "age";
  const subText = isAge && ageData
    ? `10년 단위 · 평균 ${ageData.mean}세 · 중위 ${ageData.median}세`
    : `${dem.bins.length}개 항목 · ${total.toLocaleString()}명`;

  return (
    <div className="bg-snow border border-parchment rounded-[9.6px] overflow-hidden flex flex-col">
      <header className="px-3.5 py-2.5 border-b border-parchment">
        <h3 className="text-body font-medium text-ink truncate">{dem.label}</h3>
        <p className="text-caption text-dusty mt-0.5">
          {subText}
        </p>
      </header>
      <div className="p-3 flex-1">
        <ResponsiveContainer width="100%" height={useDonut ? 220 : 260}>
          {useDonut ? (
            <PieChart>
              <Pie
                data={dem.bins}
                dataKey="count"
                nameKey="label"
                innerRadius={42}
                outerRadius={74}
                paddingAngle={2}
                label={(entry) => {
                  const pct = (entry.percent ?? 0) * 100;
                  // 너무 작은 조각(<5%)은 라벨 생략해 시각 혼잡 방지
                  return pct < 5 ? "" : `${pct.toFixed(0)}%`;
                }}
                labelLine={false}
              >
                {dem.bins.map((_, i) => (
                  <Cell
                    key={i}
                    fill={DONUT_COLORS[i % DONUT_COLORS.length]}
                    stroke="#faf9f5"
                    strokeWidth={2}
                  />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null;
                  const d = payload[0].payload as DistributionBin;
                  const pct =
                    total > 0 ? ((d.count / total) * 100).toFixed(1) : "0";
                  return (
                    <div className="bg-snow border border-parchment rounded-[9.6px] p-2 text-caption">
                      <p className="font-medium text-ink">{d.label}</p>
                      <p className="text-graphite">
                        {d.count.toLocaleString()}명 · {pct}%
                      </p>
                    </div>
                  );
                }}
              />
            </PieChart>
          ) : (
            <BarChart
              data={dem.bins}
              layout="vertical"
              margin={{ top: 4, right: 56, bottom: 4, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#dedcd1" />
              <XAxis
                type="number"
                tick={{ fontSize: 10, fill: "#73726c", fontFamily: "SUITE" }}
                stroke="#dedcd1"
                tickFormatter={(v) => (v / 1000).toFixed(0) + "k"}
              />
              <YAxis
                type="category"
                dataKey="label"
                tick={{ fontSize: 10, fill: "#3d3d3a", fontFamily: "SUITE" }}
                stroke="#dedcd1"
                width={110}
                interval={0}
              />
              <Tooltip
                cursor={{ fill: "rgba(217, 119, 87, 0.08)" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null;
                  const d = payload[0].payload as DistributionBin;
                  const pct =
                    total > 0 ? ((d.count / total) * 100).toFixed(1) : "0";
                  return (
                    <div className="bg-snow border border-parchment rounded-[9.6px] p-2 text-caption">
                      <p className="font-medium text-ink">{d.label}</p>
                      <p className="text-graphite">
                        {d.count.toLocaleString()} · {pct}%
                      </p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="count" fill="#d97757" radius={[0, 3, 3, 0]}>
                <LabelList
                  dataKey="count"
                  position="right"
                  fill="#3d3d3a"
                  fontSize={10}
                  fontFamily="SUITE"
                  formatter={(v) => {
                    const n = Number(v ?? 0);
                    return `${formatCompact(n)} · ${formatPercent(n, total)}`;
                  }}
                />
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>

        {useDonut && (
          <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-caption">
            {dem.bins.map((b, i) => {
              const pct =
                total > 0 ? ((b.count / total) * 100).toFixed(1) : "0";
              return (
                <li key={b.label} className="flex items-center gap-2">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{
                      background: DONUT_COLORS[i % DONUT_COLORS.length],
                    }}
                  />
                  <span className="text-graphite truncate">{b.label}</span>
                  <span className="text-dusty ml-auto">{pct}%</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
