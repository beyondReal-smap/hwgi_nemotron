"use client";

import { useState } from "react";
import type { QuestionReport } from "@/lib/api";

/**
 * 주관식 — 대표 응답 5건 (confidence 상위) + 글자수 통계.
 * 워드 클라우드는 Phase 2 (이번 MVP 제외).
 */
export function ReportOpenEnded({ q }: { q: QuestionReport }) {
  const samples = q.open_ended_samples ?? [];

  return (
    <section className="bg-vellum border border-parchment rounded-[9.6px] overflow-hidden flex flex-col">
      <header className="bg-snow border-b border-parchment border-l-4 border-l-terra px-5 py-4">
        <p className="text-overline text-dusty mb-0.5">Q{q.order} · 주관식</p>
        <h3 className="text-title text-ink">{q.text}</h3>
        <p className="text-body-sm text-dusty mt-1">
          {q.total_responses.toLocaleString()}명 응답
          {q.open_ended_length_avg !== null && (
            <>
              {" · 평균 "}
              <span className="font-mono text-graphite">
                {q.open_ended_length_avg.toFixed(0)}
              </span>
              자
            </>
          )}
          {q.open_ended_length_max !== null && (
            <>
              {" · 최대 "}
              <span className="font-mono text-graphite">{q.open_ended_length_max}</span>
              자
            </>
          )}
          {" · 평균 자신감 "}
          <span className="font-mono text-terra">{(q.avg_confidence * 100).toFixed(0)}%</span>
        </p>
      </header>

      <div className="p-4">
        {samples.length === 0 ? (
          <p className="text-caption text-stone text-center py-6">응답 없음</p>
        ) : (
          <>
            <p className="text-caption text-dusty mb-3">
              자신감 상위 {samples.length}건 — 전체 응답은 응답 결과 페이지에서
            </p>
            <ul className="space-y-3">
              {samples.map((s, i) => (
                <SampleCard key={s.persona_uuid} sample={s} rank={i + 1} />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

function SampleCard({
  sample,
  rank,
}: {
  sample: {
    persona_uuid: string;
    sex: string;
    age: number;
    province: string;
    occupation: string;
    answer: string;
    reasoning: string;
    confidence: number;
  };
  rank: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = sample.answer.length > 200;
  const display = !expanded && isLong ? sample.answer.slice(0, 200) + "…" : sample.answer;

  return (
    <li className="bg-snow border border-parchment rounded-[9.6px] overflow-hidden">
      <header className="px-4 py-2 border-b border-parchment flex items-baseline justify-between gap-2">
        <p className="text-caption text-graphite truncate">
          <span className="text-stone font-mono mr-1">#{rank}</span>
          <span className="font-medium text-ink">
            {sample.sex} {sample.age}세
          </span>
          {" · "}
          {sample.province}
          {" · "}
          {sample.occupation || "—"}
        </p>
        <span className="text-caption font-mono text-terra tabular-nums shrink-0">
          {(sample.confidence * 100).toFixed(0)}%
        </span>
      </header>
      <div className="p-4">
        <p className="text-body text-ink leading-relaxed whitespace-pre-wrap">{display}</p>
        {isLong && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-caption text-graphite hover:text-terra mt-1"
          >
            {expanded ? "접기" : "전체 보기"}
          </button>
        )}
        {sample.reasoning && (
          <p className="text-caption text-dusty mt-2 pt-2 border-t border-parchment">
            <strong className="text-graphite">근거:</strong> {sample.reasoning}
          </p>
        )}
      </div>
    </li>
  );
}
