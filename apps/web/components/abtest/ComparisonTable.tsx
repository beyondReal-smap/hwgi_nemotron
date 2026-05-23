"use client";

import type { ABComparison } from "@/lib/api";

type Props = {
  labelA: string;
  labelB: string;
  comparison: ABComparison;
};

/** A vs B 비교 표 — winner 표시(▲)로 우위 강조. 분기형(tie)은 중립. */
export function ComparisonTable({ labelA, labelB, comparison }: Props) {
  const rows = comparison.summary_table;
  if (rows.length === 0) return null;

  return (
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
      <header className="bg-snow border-b border-parchment border-l-4 border-l-ink px-4 py-3 sm:px-5 sm:py-4">
        <h2 className="text-title text-ink">A vs B 비교 표</h2>
        <p className="text-body-sm text-dusty mt-1">
          모집단 통계·소구점·페르소나 의견을 항목별로 직접 비교
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="bg-snow/60 text-graphite text-overline">
              <th className="text-left px-4 py-2.5 font-medium">항목</th>
              <th className="text-left px-4 py-2.5 font-medium">{labelA}</th>
              <th className="text-left px-4 py-2.5 font-medium">{labelB}</th>
              <th className="text-left px-4 py-2.5 font-medium">차이 / 우위</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={row.key}
                className={`${idx % 2 === 0 ? "bg-vellum" : "bg-snow/30"} border-t border-parchment`}
              >
                <td className="px-4 py-2.5 text-ink font-medium">{row.label}</td>
                <td
                  className={`px-4 py-2.5 ${
                    row.winner === "A" ? "text-ink font-semibold" : "text-graphite"
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {row.winner === "A" && (
                      <span aria-label="A 우위" className="text-azure">
                        ▲
                      </span>
                    )}
                    {row.a_value}
                  </span>
                </td>
                <td
                  className={`px-4 py-2.5 ${
                    row.winner === "B" ? "text-ink font-semibold" : "text-graphite"
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {row.winner === "B" && (
                      <span aria-label="B 우위" className="text-terra">
                        ▲
                      </span>
                    )}
                    {row.b_value}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-dusty">{row.delta}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
