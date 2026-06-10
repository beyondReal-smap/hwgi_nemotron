"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CannibalResponse } from "@/lib/api";

/**
 * 포트폴리오 커버리지 — greedy union 누적 도달 라인차트 + marginal lift 표.
 * "안을 몇 개, 어떤 순서로 내야 충분한가"의 포화 곡선.
 */
export function CoverageTab({ data }: { data: CannibalResponse }) {
  const cov = data.coverage ?? [];
  if (cov.length === 0) {
    return <Empty />;
  }

  const chartData = cov.map((s) => ({
    name: `${s.rank}. ${s.label}`,
    cumulative: s.cumulative,
  }));
  const totalReach = cov[cov.length - 1]?.cumulative ?? 0;
  // 포화점: marginal이 전체 도달의 5% 미만으로 떨어지는 첫 지점
  const satIdx = cov.findIndex(
    (s, i) => i > 0 && totalReach > 0 && s.marginal / totalReach < 0.05,
  );

  return (
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
      <header className="bg-snow border-b border-parchment px-5 py-4">
        <h2 className="text-title text-ink">포트폴리오 커버리지</h2>
        <p className="text-body-sm text-dusty mt-1.5">
          가장 큰 응답층부터, 새로 닿는 인원이 큰 순으로 라인업을 키울 때 누적
          도달. 곡선이 평평해지는 지점이 포화점입니다.
        </p>
      </header>
      <div className="p-4 space-y-4">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart
            data={chartData}
            margin={{ top: 16, right: 20, bottom: 36, left: 12 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#dedcd1" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fill: "#73726c" }}
              stroke="#dedcd1"
              angle={-15}
              textAnchor="end"
              height={48}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#73726c" }}
              stroke="#dedcd1"
              width={64}
              tickFormatter={(v: number) => v.toLocaleString()}
            />
            <Tooltip
              formatter={(v) => [`${Number(v).toLocaleString()}명`, "누적 도달"]}
              cursor={{ stroke: "#d97757", strokeWidth: 1 }}
            />
            <Line
              dataKey="cumulative"
              stroke="#d97757"
              strokeWidth={2}
              dot={{ fill: "#d97757", r: 4 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>

        {/* marginal lift 표 */}
        <div className="space-y-1">
          {cov.map((s, i) => (
            <div
              key={i}
              className="flex items-center justify-between text-caption text-graphite border-b border-parchment/60 py-1.5"
            >
              <span className="font-medium">
                {s.rank}. {s.label}
              </span>
              <span className="num-tabular">
                +{s.marginal.toLocaleString()}명 → 누적 {s.cumulative.toLocaleString()}명
                {satIdx === i && (
                  <span className="ml-2 text-warning font-medium">← 포화 시작</span>
                )}
              </span>
            </div>
          ))}
        </div>

        <p className="text-caption text-dusty">
          반응 응답층을 모두 합친 도달이며, 실제 시장 침투율이 아닙니다. 라인업 순서는 도달을
          최대화하도록 정렬했습니다.
        </p>
      </div>
    </section>
  );
}

function Empty() {
  return (
    <div className="rounded-[9.6px] border border-parchment bg-snow/40 p-6 text-body-sm text-dusty text-center">
      커버리지 데이터가 없습니다.
    </div>
  );
}
