"use client";

import { useState, useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RegionStat } from "@/lib/api";

type Props = {
  provinceStats: RegionStat[];
  districtStats: RegionStat[];
};

export function RegionChart({ provinceStats, districtStats }: Props) {
  const [selectedProvince, setSelectedProvince] = useState<string | null>(null);

  const data = useMemo(() => {
    if (!selectedProvince) return provinceStats;
    // 시군구는 "서울-서초구" 형식이므로 시도명으로 prefix 매칭
    return districtStats.filter((d) =>
      d.name.startsWith(`${selectedProvince}-`),
    );
  }, [selectedProvince, provinceStats, districtStats]);

  function handleClick(payload: { activeLabel?: string | number } | null) {
    if (selectedProvince) return; // 시군구 화면에서는 추가 클릭 무시
    const raw = payload?.activeLabel;
    if (raw === undefined || raw === null) return;
    const label = String(raw);
    // 해당 시도의 시군구 데이터가 있는지 확인 (drill-down 가능 여부)
    const hasDistricts = districtStats.some((d) =>
      d.name.startsWith(`${label}-`),
    );
    if (hasDistricts) setSelectedProvince(label);
  }

  return (
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
      <header className="bg-snow border-b border-parchment border-l-4 border-l-azure px-5 py-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-title text-ink">
            {selectedProvince ? `${selectedProvince} 시군구 분포` : "시도별 분포"}
          </h2>
          <p className="text-body-sm text-dusty mt-1">
            {selectedProvince
              ? "막대 위에 마우스를 올려 상세 보기"
              : "상위 3개 시도 클릭 시 시군구 상세 보기"}
          </p>
        </div>
        {selectedProvince && (
          <button
            type="button"
            onClick={() => setSelectedProvince(null)}
            className="text-body-sm font-semibold text-ink hover:text-terra underline focus:outline-none focus-visible:ring-2 focus-visible:ring-azure rounded shrink-0"
          >
            전체 시도
          </button>
        )}
      </header>

      <div className="p-4">
        <ResponsiveContainer width="100%" height={320}>
          <BarChart
            data={data}
            margin={{ top: 8, right: 16, bottom: 16, left: 0 }}
            onClick={handleClick}
          >
            <defs>
              <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#d97757" stopOpacity={1} />
                <stop offset="100%" stopColor="#d97757" stopOpacity={0.65} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#dedcd1" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 12, fill: "#73726c", fontFamily: "SUITE" }}
              interval={0}
              angle={-30}
              dy={12}
              height={52}
              stroke="#dedcd1"
            />
            <YAxis
              tick={{ fontSize: 12, fill: "#73726c", fontFamily: "SUITE" }}
              stroke="#dedcd1"
              width={36}
            />
            <Tooltip
              cursor={{ fill: "rgba(217, 119, 87, 0.08)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload as RegionStat;
                return (
                  <div className="bg-snow border border-parchment rounded-[9.6px] p-3 shadow-sm">
                    <p className="text-body-sm font-semibold text-ink mb-1">{d.name}</p>
                    <p className="text-caption text-graphite num-tabular">
                      반응 페르소나:{" "}
                      <span className="font-semibold text-terra">
                        {d.count}명
                      </span>
                    </p>
                    <p className="text-caption text-graphite num-tabular">
                      평균 반응도:{" "}
                      <span className="font-semibold text-ink">
                        {d.avg_score.toFixed(1)}
                      </span>
                    </p>
                  </div>
                );
              }}
            />
            <Bar
              dataKey="count"
              fill="url(#barGradient)"
              radius={[6, 6, 0, 0]}
              cursor="pointer"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
