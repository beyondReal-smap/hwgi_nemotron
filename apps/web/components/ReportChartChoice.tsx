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
import type { QuestionReport } from "@/lib/api";

/**
 * 객관식·NPS 도넛/막대 차트.
 *  - 선택지 ≤ 4개: 도넛 + 레전드
 *  - 선택지 > 4개: 가로 막대 + 카운트 라벨
 */
const COLORS = ["#d97757", "#ccdbe8", "#3d3d3a", "#73726c", "#9c9a92", "#dedcd1", "#1f1e1d"];

export function ReportChartChoice({ q }: { q: QuestionReport }) {
  const dist = q.choice_distribution ?? {};
  const data = Object.entries(dist).map(([label, count]) => ({ label, count }));
  const total = data.reduce((s, d) => s + d.count, 0);
  const useDonut = data.length <= 4;

  return (
    <section className="bg-vellum border border-parchment rounded-[9.6px] overflow-hidden flex flex-col">
      <header className="bg-snow border-b border-parchment border-l-4 border-l-terra px-5 py-4">
        <p className="text-overline text-dusty mb-0.5">
          Q{q.order} · {q.type === "nps" ? "NPS" : q.type === "multi_choice" ? "다중 선택" : "단일 선택"}
        </p>
        <h3 className="text-title text-ink">{q.text}</h3>
        <p className="text-body-sm text-dusty mt-1">
          {q.total_responses.toLocaleString()}명 응답 · 평균 자신감{" "}
          <span className="font-mono text-terra">{(q.avg_confidence * 100).toFixed(0)}%</span>
        </p>
      </header>

      <div className="p-4">
        {total === 0 ? (
          <p className="text-caption text-stone text-center py-6">응답 없음</p>
        ) : useDonut ? (
          <DonutLayout data={data} total={total} />
        ) : (
          <BarLayout data={data} total={total} />
        )}
      </div>
    </section>
  );
}

function DonutLayout({ data, total }: { data: { label: string; count: number }[]; total: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={data}
            dataKey="count"
            nameKey="label"
            innerRadius={56}
            outerRadius={96}
            paddingAngle={2}
            label={(entry) => {
              const pct = (entry.percent ?? 0) * 100;
              return pct < 5 ? "" : `${pct.toFixed(0)}%`;
            }}
            labelLine={false}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="#faf9f5" strokeWidth={2} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null;
              const d = payload[0].payload as { label: string; count: number };
              const pct = total > 0 ? ((d.count / total) * 100).toFixed(1) : "0";
              return (
                <div className="bg-snow border border-parchment rounded-[9.6px] p-2 text-caption">
                  <p className="font-medium text-ink">{d.label}</p>
                  <p className="text-graphite">{d.count.toLocaleString()}명 · {pct}%</p>
                </div>
              );
            }}
          />
        </PieChart>
      </ResponsiveContainer>

      <ul className="grid grid-cols-1 gap-1 text-body-sm">
        {data.map((d, i) => {
          const pct = total > 0 ? ((d.count / total) * 100).toFixed(1) : "0";
          return (
            <li key={d.label} className="flex items-baseline gap-2">
              <span
                className="inline-block w-3 h-3 rounded-sm shrink-0"
                style={{ background: COLORS[i % COLORS.length] }}
              />
              <span className="text-ink min-w-0 truncate">{d.label}</span>
              <span className="text-graphite ml-auto font-mono tabular-nums shrink-0">
                {d.count.toLocaleString()}
                <span className="text-dusty ml-1">({pct}%)</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function BarLayout({ data, total }: { data: { label: string; count: number }[]; total: number }) {
  // 카운트 내림차순 정렬
  const sorted = [...data].sort((a, b) => b.count - a.count);
  return (
    <ResponsiveContainer width="100%" height={Math.max(240, sorted.length * 36)}>
      <BarChart
        data={sorted}
        layout="vertical"
        margin={{ top: 4, right: 56, bottom: 4, left: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#dedcd1" />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: "#73726c", fontFamily: "SUITE" }}
          stroke="#dedcd1"
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fontSize: 11, fill: "#3d3d3a", fontFamily: "SUITE" }}
          stroke="#dedcd1"
          width={120}
          interval={0}
        />
        <Tooltip
          cursor={{ fill: "rgba(217, 119, 87, 0.08)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload as { label: string; count: number };
            const pct = total > 0 ? ((d.count / total) * 100).toFixed(1) : "0";
            return (
              <div className="bg-snow border border-parchment rounded-[9.6px] p-2 text-caption">
                <p className="font-medium text-ink">{d.label}</p>
                <p className="text-graphite">{d.count.toLocaleString()}명 · {pct}%</p>
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
            formatter={(v) => {
              const n = Number(v ?? 0);
              const pct = total > 0 ? ((n / total) * 100).toFixed(0) : "0";
              return `${n} · ${pct}%`;
            }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
