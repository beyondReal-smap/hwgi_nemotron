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
import type { QuestionReport } from "@/lib/api";
import { CHART_SINGLE, npsColor, SEMANTIC } from "@/lib/chartColors";

/**
 * 척도형 히스토그램 (scale / nps).
 *  - X축: 점수 (scale_min~max)
 *  - Y축: 응답 수
 *  - 막대 위에 카운트
 *  - 하단에 평균/중앙값 표시
 */
export function ReportChartScale({ q }: { q: QuestionReport }) {
  const hist = q.scale_histogram ?? [];
  const total = hist.reduce((s, d) => s + d.count, 0);

  return (
    <section className="bg-vellum border border-parchment rounded-[9.6px] overflow-hidden flex flex-col">
      <header className="bg-snow border-b border-parchment px-5 py-4">
        <p className="text-overline text-dusty mb-0.5">
          Q{q.order} · {q.type === "nps" ? "NPS (0-10)" : "척도"}
        </p>
        <h3 className="text-title text-ink">{q.text}</h3>
        <p className="text-body-sm text-dusty mt-1">
          {q.total_responses.toLocaleString()}명 응답
          {q.scale_mean !== null && (
            <>
              {" · 평균 "}
              <span className="font-mono text-terra">{q.scale_mean.toFixed(2)}</span>
            </>
          )}
          {q.scale_median !== null && (
            <>
              {" · 중앙값 "}
              <span className="font-mono text-graphite">{q.scale_median.toFixed(1)}</span>
            </>
          )}
          {" · 평균 확신도 "}
          <span className="font-mono text-graphite">{(q.avg_confidence * 100).toFixed(0)}%</span>
        </p>
      </header>

      <div className="p-4">
        {total === 0 ? (
          <p className="text-caption text-stone text-center py-6">응답 없음</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={hist} margin={{ top: 24, right: 16, bottom: 24, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dedcd1" />
                <XAxis
                  dataKey="score"
                  tick={{ fontSize: 11, fill: "#73726c", fontFamily: "SUITE" }}
                  stroke="#dedcd1"
                  label={{
                    value: makeAxisLabel(hist),
                    position: "insideBottom",
                    offset: -10,
                    style: { fontSize: 11, fill: "#73726c" },
                  }}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#73726c", fontFamily: "SUITE" }}
                  stroke="#dedcd1"
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ fill: "rgba(217, 119, 87, 0.08)" }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null;
                    const d = payload[0].payload as { score: number; count: number; label: string | null };
                    const pct = total > 0 ? ((d.count / total) * 100).toFixed(1) : "0";
                    return (
                      <div className="bg-snow border border-parchment rounded-[9.6px] p-2 text-caption">
                        <p className="font-medium text-ink">
                          {d.score}{d.label && ` (${d.label})`}
                        </p>
                        <p className="text-graphite">{d.count.toLocaleString()}명 · {pct}%</p>
                      </div>
                    );
                  }}
                />
                {/* NPS는 점수 구간(추천/중립/비추천)을 시맨틱 색으로 구분. 일반 척도는 단색 terra. */}
                <Bar dataKey="count" fill={CHART_SINGLE} radius={[6, 6, 0, 0]}>
                  {q.type === "nps" &&
                    hist.map((d, i) => (
                      <Cell key={i} fill={npsColor(d.score)} />
                    ))}
                  <LabelList
                    dataKey="count"
                    position="top"
                    fill="#3d3d3a"
                    fontSize={11}
                    fontFamily="SUITE"
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {q.type === "nps" && <NpsLegend />}
          </>
        )}
      </div>
    </section>
  );
}

/** NPS 색 구간 범례 — 막대 색의 의미(추천/중립/비추천)를 명시. */
function NpsLegend() {
  const items = [
    { c: SEMANTIC.success, label: "추천자 9–10" },
    { c: SEMANTIC.warning, label: "중립 7–8" },
    { c: SEMANTIC.danger, label: "비추천 0–6" },
  ];
  return (
    <ul className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-caption text-graphite">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
            style={{ background: it.c }}
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

function makeAxisLabel(hist: { score: number; label: string | null }[]): string {
  if (hist.length === 0) return "";
  const first = hist[0];
  const last = hist[hist.length - 1];
  if (first.label && last.label) {
    return `${first.label} → ${last.label}`;
  }
  return "";
}
