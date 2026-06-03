"use client";

import type { SurveyQuestion } from "@/lib/api";

/**
 * 미리보기 — 실제 페르소나가 받게 될 폼 시뮬레이션 (모든 입력은 disabled).
 */
export function QuestionPreview({ question }: { question: SurveyQuestion }) {
  return (
    <div className="bg-vellum border border-parchment rounded-[9.6px] overflow-hidden">
      <header className="px-4 py-2.5 border-b border-parchment">
        <h3 className="text-body font-medium text-ink">미리보기</h3>
        <p className="text-caption text-dusty mt-0.5">페르소나가 받게 될 형태</p>
      </header>
      <div className="p-4">
        <p className="text-body text-ink mb-3">
          <span className="text-caption text-stone font-mono mr-2">Q{question.order}.</span>
          {question.text || (
            <span className="text-stone italic">질문 내용 미입력</span>
          )}
          {question.required && <span className="text-terra ml-1">*</span>}
        </p>
        {(question.type === "single_choice" || question.type === "multi_choice") && (
          <ul className="space-y-1.5">
            {question.options.map((o, i) => (
              <li key={i} className="flex items-center gap-2">
                <input
                  type={question.type === "single_choice" ? "radio" : "checkbox"}
                  disabled
                  className="accent-terra"
                />
                <span className="text-body-sm text-graphite">
                  {o || <span className="text-stone italic">선택지 {i + 1}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {(question.type === "scale" || question.type === "nps") &&
          question.scale_min !== null &&
          question.scale_max !== null && (
            <div>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-caption text-dusty">
                  {question.scale_label_low || question.scale_min}
                </span>
                <div className="flex gap-1 flex-wrap">
                  {Array.from(
                    { length: question.scale_max - question.scale_min + 1 },
                    (_, i) => question.scale_min! + i,
                  ).map((v) => (
                    <span
                      key={v}
                      className="inline-flex items-center justify-center w-8 h-8 text-body-sm text-graphite bg-snow border border-parchment rounded"
                    >
                      {v}
                    </span>
                  ))}
                </div>
                <span className="text-caption text-dusty">
                  {question.scale_label_high || question.scale_max}
                </span>
              </div>
            </div>
          )}
        {question.type === "open_ended" && (
          <textarea
            disabled
            placeholder="페르소나가 자유 텍스트로 응답"
            rows={3}
            className="w-full px-3 py-2 bg-snow border border-parchment rounded-[9.6px] text-body-sm text-stone resize-none"
          />
        )}
      </div>
    </div>
  );
}
