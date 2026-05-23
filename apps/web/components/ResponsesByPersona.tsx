"use client";

import { useMemo, useState } from "react";
import type { PersonaWithSession, SurveyQuestion } from "@/lib/api";

/**
 * 페르소나별 응답 뷰 — 좌 페르소나 목록 / 우 답변 + reasoning.
 *
 * 좌측 클릭 → 해당 페르소나의 모든 질문 답변이 우측에 카드 형태로 노출.
 * 추론 근거는 "추론 보기" 토글로 펼침.
 */
export function ResponsesByPersona({
  items,
  questions,
}: {
  items: PersonaWithSession[];
  questions: SurveyQuestion[];
}) {
  const [selectedUuid, setSelectedUuid] = useState<string | null>(
    items[0]?.persona_uuid ?? null,
  );

  const selected = useMemo(
    () => items.find((it) => it.persona_uuid === selectedUuid) ?? null,
    [items, selectedUuid],
  );

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.6fr] gap-4">
      {/* 좌측: 페르소나 목록 */}
      <section className="bg-vellum border border-parchment rounded-[9.6px] overflow-hidden">
        <header className="bg-snow border-b border-parchment border-l-4 border-l-terra px-5 py-4">
          <h2 className="text-title text-ink">페르소나 ({items.length})</h2>
          <p className="text-body-sm text-dusty mt-1">선택하면 우측에 답변이 표시됩니다</p>
        </header>
        {items.length === 0 ? (
          <div className="p-6 text-center text-body-sm text-graphite">
            응답이 없습니다
          </div>
        ) : (
          <ul className="divide-y divide-parchment max-h-[700px] overflow-auto">
            {items.map((it) => {
              const isSel = selectedUuid === it.persona_uuid;
              const isFailed = it.session.status === "failed";
              return (
                <li key={it.persona_uuid}>
                  <button
                    type="button"
                    onClick={() => setSelectedUuid(it.persona_uuid)}
                    className={`w-full text-left px-4 py-3 transition-colors border-l-4 ${
                      isSel
                        ? "bg-snow border-l-terra"
                        : isFailed
                          ? "border-l-transparent hover:bg-snow/60"
                          : "border-l-transparent hover:bg-snow/60"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <p className="text-body text-ink font-medium truncate">
                        {it.sex} · {it.age}세
                      </p>
                      {isFailed && (
                        <span className="text-caption text-terra shrink-0">실패</span>
                      )}
                    </div>
                    <p className="text-caption text-dusty truncate">
                      {it.province} · {it.district} · {it.occupation || "—"}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 우측: 답변 상세 */}
      <section className="flex flex-col gap-4">
        {selected ? (
          <PersonaDetail item={selected} questions={questions} />
        ) : (
          <div className="bg-snow border border-parchment rounded-[9.6px] p-8 text-center">
            <p className="text-body-sm text-graphite">왼쪽에서 페르소나를 선택하세요</p>
          </div>
        )}
      </section>
    </div>
  );
}

// ============================================================
// 우측 상세
// ============================================================

function PersonaDetail({
  item,
  questions,
}: {
  item: PersonaWithSession;
  questions: SurveyQuestion[];
}) {
  const answersByQid = useMemo(() => {
    const m = new Map<string, (typeof item.session.answers)[number]>();
    for (const a of item.session.answers) m.set(a.question_id, a);
    return m;
  }, [item.session.answers]);

  return (
    <>
      {/* 프로필 요약 카드 */}
      <section className="bg-vellum border border-parchment rounded-[9.6px] overflow-hidden">
        <header className="bg-snow border-b border-parchment border-l-4 border-l-terra px-5 py-4">
          <h3 className="text-title text-ink">
            {item.sex} · {item.age}세
          </h3>
          <p className="text-body-sm text-dusty mt-1">
            {item.province} · {item.district} · {item.occupation || "—"}
            {item.marital_status && ` · ${item.marital_status}`}
            {item.family_type && ` · ${item.family_type}`}
          </p>
        </header>
        <div className="p-4">
          <p className="text-body-sm text-graphite leading-relaxed line-clamp-4">
            {item.persona}
          </p>
          <p className="text-caption text-dusty mt-2 tabular-nums">
            모델 <span className="font-mono">{item.session.llm_model_used}</span> ·
            토큰 <span className="font-mono">{item.session.total_tokens.toLocaleString()}</span>
            {item.session.error && (
              <span className="text-terra ml-2">⚠ {item.session.error}</span>
            )}
          </p>
        </div>
      </section>

      {/* 질문별 답변 카드 */}
      {questions.map((q) => {
        const a = answersByQid.get(q.id);
        return (
          <AnswerCard key={q.id} question={q} answer={a} />
        );
      })}
    </>
  );
}

function AnswerCard({
  question,
  answer,
}: {
  question: SurveyQuestion;
  answer: { answer_value: string | number | string[]; reasoning: string; confidence: number } | undefined;
}) {
  const [reasoningOpen, setReasoningOpen] = useState(false);
  return (
    <section className="bg-snow border border-parchment rounded-[9.6px] overflow-hidden">
      <header className="px-4 py-2.5 border-b border-parchment">
        <p className="text-overline text-dusty mb-0.5">
          Q{question.order} · {QUESTION_TYPE_LABELS[question.type]}
        </p>
        <h4 className="text-body text-ink">{question.text}</h4>
      </header>
      <div className="p-4">
        {answer ? (
          <>
            <p className="text-body text-ink">
              <span className="font-medium">
                {formatAnswerValue(answer.answer_value)}
              </span>
            </p>
            <p className="text-caption text-dusty mt-1 tabular-nums">
              자신감 <span className="font-mono text-terra">
                {(answer.confidence * 100).toFixed(0)}%
              </span>
            </p>
            {answer.reasoning && (
              <div className="mt-3 pt-3 border-t border-parchment">
                <button
                  type="button"
                  onClick={() => setReasoningOpen(!reasoningOpen)}
                  className="text-caption text-graphite hover:text-terra transition-colors flex items-center gap-1"
                  aria-expanded={reasoningOpen}
                >
                  <span
                    className={`inline-block transition-transform ${
                      reasoningOpen ? "rotate-90" : ""
                    }`}
                    aria-hidden
                  >
                    ▸
                  </span>
                  추론 근거
                </button>
                {reasoningOpen && (
                  <p className="text-body-sm text-graphite leading-relaxed mt-2 pl-4 border-l-2 border-l-parchment">
                    {answer.reasoning}
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="text-caption text-stone italic">답변 없음</p>
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

function formatAnswerValue(v: string | number | string[]): string {
  if (Array.isArray(v)) return v.join(" · ");
  return String(v);
}
