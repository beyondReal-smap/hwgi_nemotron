"use client";

import { useMemo, useState } from "react";
import type { PersonaWithSession, SurveyQuestion } from "@/lib/api";

/**
 * 질문별 응답 뷰 — 질문 선택 → 모든 페르소나의 답변을 표/카드로 비교.
 *
 * 객관식·척도·NPS: 표 형태 (페르소나 + 답변 + 자신감)
 * 주관식: 카드 형태 (답변 텍스트 + 페르소나 라벨 + 자신감)
 */
export function ResponsesByQuestion({
  items,
  questions,
}: {
  items: PersonaWithSession[];
  questions: SurveyQuestion[];
}) {
  const [selectedQid, setSelectedQid] = useState<string>(
    questions[0]?.id ?? "",
  );

  const selectedQuestion = useMemo(
    () => questions.find((q) => q.id === selectedQid) ?? null,
    [questions, selectedQid],
  );

  const answers = useMemo(() => {
    if (!selectedQuestion) return [];
    return items
      .map((it) => {
        const a = it.session.answers.find((x) => x.question_id === selectedQid);
        return a ? { item: it, answer: a } : null;
      })
      .filter((x): x is { item: PersonaWithSession; answer: typeof items[number]["session"]["answers"][number] } => x !== null);
  }, [items, selectedQid, selectedQuestion]);

  return (
    <section className="bg-vellum border border-parchment rounded-[9.6px] overflow-hidden">
      <header className="bg-snow border-b border-parchment border-l-4 border-l-terra px-5 py-4 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-title text-ink">질문별 응답</h2>
          <p className="text-body-sm text-dusty mt-1">
            {answers.length}명 응답
            {selectedQuestion && ` · 유형: ${QUESTION_TYPE_LABELS[selectedQuestion.type]}`}
          </p>
        </div>
        <select
          value={selectedQid}
          onChange={(e) => setSelectedQid(e.target.value)}
          className="px-3 py-2 bg-vellum border border-onyx/15 rounded-[9.6px] text-body-sm text-ink min-w-[16rem]
                     focus:outline-none focus:ring-2 focus:ring-azure"
        >
          {questions.map((q) => (
            <option key={q.id} value={q.id}>
              Q{q.order}. {q.text.slice(0, 40)}
              {q.text.length > 40 && "…"}
            </option>
          ))}
        </select>
      </header>

      <div className="p-4">
        {!selectedQuestion ? (
          <p className="text-caption text-stone text-center py-6">질문을 선택하세요</p>
        ) : answers.length === 0 ? (
          <p className="text-caption text-stone text-center py-6">응답이 없습니다</p>
        ) : selectedQuestion.type === "open_ended" ? (
          <OpenEndedList answers={answers} />
        ) : (
          <ChoiceTable answers={answers} />
        )}
      </div>
    </section>
  );
}

const QUESTION_TYPE_LABELS: Record<string, string> = {
  single_choice: "단일 선택",
  multi_choice: "다중 선택",
  scale: "척도",
  open_ended: "주관식",
  nps: "NPS",
};

// ============================================================
// 객관식·척도·NPS — 표
// ============================================================

function ChoiceTable({
  answers,
}: {
  answers: { item: PersonaWithSession; answer: PersonaWithSession["session"]["answers"][number] }[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-body-sm">
        <thead className="bg-snow">
          <tr className="text-left text-overline text-dusty">
            <th className="px-3 py-2">페르소나</th>
            <th className="px-3 py-2">답변</th>
            <th className="px-3 py-2 text-right">자신감</th>
            <th className="px-3 py-2">근거</th>
          </tr>
        </thead>
        <tbody>
          {answers.map(({ item, answer }) => (
            <tr key={item.persona_uuid} className="border-t border-parchment hover:bg-snow/60">
              <td className="px-3 py-2 text-graphite whitespace-nowrap">
                {item.sex} {item.age}세 · {item.province}
              </td>
              <td className="px-3 py-2 text-ink font-medium">
                {formatValue(answer.answer_value)}
              </td>
              <td className="px-3 py-2 text-right text-terra font-mono tabular-nums">
                {(answer.confidence * 100).toFixed(0)}%
              </td>
              <td className="px-3 py-2 text-caption text-graphite max-w-md truncate">
                {answer.reasoning || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// 주관식 — 카드 리스트
// ============================================================

function OpenEndedList({
  answers,
}: {
  answers: { item: PersonaWithSession; answer: PersonaWithSession["session"]["answers"][number] }[];
}) {
  // 자신감 내림차순 정렬
  const sorted = [...answers].sort((a, b) => b.answer.confidence - a.answer.confidence);

  return (
    <ul className="space-y-3 max-h-[700px] overflow-auto">
      {sorted.map(({ item, answer }) => (
        <li
          key={item.persona_uuid}
          className="bg-snow border border-parchment rounded-[9.6px] overflow-hidden"
        >
          <header className="px-4 py-2 border-b border-parchment flex items-baseline justify-between gap-2">
            <p className="text-caption text-graphite truncate">
              <span className="font-medium text-ink">{item.sex} {item.age}세</span>
              {" · "}{item.province} · {item.occupation || "—"}
            </p>
            <span className="text-caption font-mono text-terra tabular-nums shrink-0">
              {(answer.confidence * 100).toFixed(0)}%
            </span>
          </header>
          <div className="p-4">
            <p className="text-body text-ink leading-relaxed whitespace-pre-wrap">
              {String(answer.answer_value)}
            </p>
            {answer.reasoning && (
              <p className="text-caption text-dusty mt-2 pt-2 border-t border-parchment">
                <strong className="text-graphite">근거:</strong> {answer.reasoning}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function formatValue(v: string | number | string[]): string {
  if (Array.isArray(v)) return v.join(" · ");
  return String(v);
}
