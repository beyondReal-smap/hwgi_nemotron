"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CannibalResponse } from "@/lib/api";

/**
 * 노출 다중도 — 각 페르소나가 몇 개 안의 반응층에 속하는지 히스토그램.
 * 2개 이상 = 여러 안에 중복 노출되는 층(타깃 캡핑·메시지 분리 대상).
 */
export function MultiplicityTab({ data }: { data: CannibalResponse }) {
  const mult = data.multiplicity ?? [];
  if (mult.length === 0) {
    return <Empty />;
  }

  const chartData = mult.map((m) => ({
    label: `${m.overlap_count}개 안`,
    count: m.persona_count,
    overlap: m.overlap_count,
  }));
  const overexposed = mult
    .filter((m) => m.overlap_count >= 2)
    .reduce((s, m) => s + m.persona_count, 0);

  return (
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
      <header className="bg-snow border-b border-parchment px-5 py-4">
        <h2 className="text-title text-ink">노출 다중도</h2>
        <p className="text-body-sm text-dusty mt-1.5">
          각 페르소나가 몇 개 안의 반응층에 속하는지. 2개 이상이면 여러 안에 중복
          노출되는 층입니다.
        </p>
      </header>
      <div className="p-4 space-y-4">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart
            data={chartData}
            margin={{ top: 20, right: 16, bottom: 8, left: 12 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#dedcd1" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "#73726c" }}
              stroke="#dedcd1"
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#73726c" }}
              stroke="#dedcd1"
              width={64}
              tickFormatter={(v: number) => v.toLocaleString()}
            />
            <Tooltip
              formatter={(v) => [`${Number(v).toLocaleString()}명`, "인원"]}
              cursor={{ fill: "rgba(217, 119, 87, 0.08)" }}
            />
            <Bar dataKey="count" radius={[6, 6, 0, 0]}>
              {chartData.map((d, i) => (
                <Cell
                  key={i}
                  fill="#d97757"
                  fillOpacity={d.overlap >= 2 ? 0.85 : 0.45}
                />
              ))}
              <LabelList
                dataKey="count"
                position="top"
                formatter={(v) => Number(v).toLocaleString()}
                style={{ fontSize: 11, fill: "#3d3d3a" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        <p className="text-body-sm text-graphite">
          중복 노출(2개 안 이상):{" "}
          <span className="font-semibold text-ink num-tabular">
            {overexposed.toLocaleString()}명
          </span>{" "}
          — 타깃 캡핑·메시지 분리 검토 대상.
        </p>
        <p className="text-caption text-dusty">
          노출 횟수는 임베딩 유사도 소속 개수이지 실제 광고 임프레션이 아닙니다.
        </p>
      </div>
    </section>
  );
}

function Empty() {
  return (
    <div className="rounded-[9.6px] border border-parchment bg-snow/40 p-6 text-body-sm text-dusty text-center">
      노출 다중도 데이터가 없습니다.
    </div>
  );
}
