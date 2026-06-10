"use client";

import { useState } from "react";
import type { CannibalResponse } from "@/lib/api";

/**
 * 잠식(반응 겹침) 행렬 히트맵.
 *
 * - 행 = 기준안(i), 열 = 대상안(j).
 * - 방향성 셀 M[i][j] = "i안 반응자 중 j안에도 반응한 비율"(비대칭). Jaccard는 대칭.
 * - 셀 농도 = terra(브랜드 주황) 그라데이션. 대각선(자기 자신)은 중립 회색으로 비교 제외.
 * - 겹침은 임베딩 의미 유사도 신호이지 실 구매 잠식이 아니므로 면책/경고를 상단 고정.
 */

type Props = { data: CannibalResponse };
type MetricKind = "directional" | "jaccard";

// terra = rgb(217,119,87). ratio(0~1)를 alpha 농도로(최대 0.92, 가독성 확보).
function cellBg(ratio: number): string {
  const a = Math.max(0, Math.min(1, ratio)) * 0.92;
  return `rgba(217, 119, 87, ${a})`;
}
// 진한 배경(ratio>0.5)은 밝은 글자(vellum), 옅으면 어두운 글자(ink).
function cellText(ratio: number): string {
  return ratio > 0.5 ? "#faf9f5" : "#141413";
}

export function CannibalMatrix({ data }: Props) {
  const [metric, setMetric] = useState<MetricKind>("directional");
  const labels = data.items.map((it) => it.label);
  const M =
    metric === "directional" ? data.directional_matrix : data.jaccard_matrix;

  return (
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
      <header className="bg-snow border-b border-parchment px-5 py-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-title text-ink">반응 겹침 행렬</h2>
          <p className="text-body-sm text-dusty mt-1.5">
            {metric === "directional"
              ? "행(기준안) 반응자 중 열(대상안)에도 반응한 비율 — 높을수록 같은 층을 노림(잠식 가능)."
              : "두 안의 반응자 합집합 대비 교집합(대칭) — 전체적 겹침 정도."}
          </p>
        </div>
        {/* 메트릭 토글 — 방향성 ↔ Jaccard */}
        <div
          role="radiogroup"
          aria-label="겹침 지표"
          className="inline-flex border border-parchment rounded-[7px] overflow-hidden bg-vellum shrink-0"
        >
          {(["directional", "jaccard"] as MetricKind[]).map((k) => {
            const active = metric === k;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setMetric(k)}
                className={`px-2.5 py-1 text-caption font-medium transition-colors ${
                  active ? "bg-ink text-vellum" : "text-graphite hover:bg-snow"
                }`}
              >
                {k === "directional" ? "방향성" : "전체 겹침"}
              </button>
            );
          })}
        </div>
      </header>

      <div className="p-4 space-y-4">
        {/* 경고 + 면책 */}
        <div className="flex flex-wrap items-center gap-2">
          {data.warnings.includes("small_cohort") && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] bg-warning/15 text-warning text-caption font-medium">
              ⚠️ 일부 안의 반응 인원이 적어(500명 미만) 겹침이 불안정할 수 있습니다
            </span>
          )}
          <span className="text-caption text-dusty">
            겹침은 응답 패턴 유사도 기반 신호이며, 실제 구매 잠식이 아닙니다. 반응층
            기준: <span className="font-medium text-graphite">{data.cohort_level}</span>
          </span>
        </div>

        {/* 히트맵 */}
        <div className="overflow-x-auto">
          <table className="border-collapse text-body-sm">
            <thead>
              <tr>
                <th className="p-2 text-left text-overline text-dusty sticky left-0 bg-vellum z-10">
                  기준 \ 대상
                </th>
                {labels.map((c, j) => (
                  <th
                    key={j}
                    className="p-2 text-overline text-graphite font-semibold min-w-[72px] text-center"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {labels.map((rLabel, i) => (
                <tr key={i}>
                  <th className="p-2 text-left text-graphite font-semibold whitespace-nowrap sticky left-0 bg-vellum border-r border-parchment z-10">
                    {rLabel}
                    <span className="block text-caption text-dusty font-normal num-tabular">
                      {data.items[i].cohort_size.toLocaleString()}명
                    </span>
                  </th>
                  {labels.map((cLabel, j) => {
                    const v = M[i]?.[j] ?? 0;
                    const isDiag = i === j;
                    const pct = Math.round(v * 100);
                    return (
                      <td
                        key={j}
                        className="p-0 border border-parchment text-center"
                        style={
                          isDiag
                            ? { background: "#dedcd1" }
                            : { background: cellBg(v) }
                        }
                        title={
                          isDiag
                            ? `${rLabel} (자기 자신)`
                            : `${rLabel} 반응자의 ${pct}%가 ${cLabel}에도 반응`
                        }
                      >
                        <span
                          className="inline-flex items-center justify-center w-full px-3 py-2.5 num-tabular font-semibold"
                          style={{ color: isDiag ? "#73726c" : cellText(v) }}
                        >
                          {isDiag ? "—" : `${pct}%`}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 범례 */}
        <div className="flex items-center gap-2 text-caption text-dusty">
          <span>겹침 낮음</span>
          <span
            className="inline-block w-24 h-3 rounded-[3px] border border-parchment"
            style={{
              background:
                "linear-gradient(to right, rgba(217,119,87,0.05), rgba(217,119,87,0.92))",
            }}
            aria-hidden
          />
          <span>높음</span>
        </div>

        {/* 읽는 법 + 정의 */}
        <div className="text-caption text-dusty space-y-1 border-t border-parchment pt-3">
          <p>
            ▸ <span className="font-medium text-graphite">진한 칸</span> = 같은 층을
            노림(잠식 위험) → 하나로 통합 검토
          </p>
          <p>
            ▸ <span className="font-medium text-graphite">옅은 칸</span> = 다른 층(보완)
            → 함께 출시 시 시장 확장
          </p>
          <p>
            ▸ <span className="font-medium text-graphite">방향성</span>: 행(기준안)
            반응자 중 열(대상안)에도 반응한 비율. 비대칭(A→B ≠ B→A, 반응층 크기 차이)
          </p>
          <p>
            ▸ <span className="font-medium text-graphite">전체 겹침</span>: 두 안에 모두
            반응한 사람의 비율. 방향 구분 없이 전체적으로 얼마나 겹치는지
          </p>
        </div>
      </div>
    </section>
  );
}
