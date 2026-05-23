"use client";

import type { ABComparison, ABTestInputMode } from "@/lib/api";

type Props = {
  labelA: string;
  labelB: string;
  comparison: ABComparison;
  inputMode?: ABTestInputMode;
};

/**
 * A vs B 비교 표 — winner 표시(▲)로 우위 강조. 분기형(tie)은 중립.
 *
 * 옛 이력 호환: comparison.summary_table은 백엔드 생성 시점의 라벨을 그대로
 * 담고 있으므로, 카피 모드에서 옛 라벨('평균 가입의향')이 들어 있으면 UI에서
 * 동적으로 치환('평균 관심도')해 일관성을 유지한다.
 */
export function ComparisonTable({ labelA, labelB, comparison, inputMode }: Props) {
  const rows = comparison.summary_table;
  if (rows.length === 0) return null;
  const isMarketing = inputMode === "marketing";

  function displayLabel(row: (typeof rows)[number]): string {
    if (!isMarketing) return row.label;
    if (row.key === "avg_intent") return "평균 관심도 (의견 샘플)";
    if (row.key === "positive_ratio") return "긍정 인상 비율";
    return row.label;
  }

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
                <td className="px-4 py-2.5 text-ink font-medium">{displayLabel(row)}</td>
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
