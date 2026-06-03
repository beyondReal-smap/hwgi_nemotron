"use client";

import type { QuestionType, SurveyQuestion } from "@/lib/api";
import { TYPE_DESCRIPTIONS, TYPE_LABELS } from "./questionUtils";

/**
 * 선택된 질문 1건의 편집 폼 — 유형 select + 필수 토글 + 텍스트 + 유형별 입력.
 * 유형별 입력은 OptionsEditor(선택지) / ScaleEditor(척도)로 위임.
 */
export function QuestionEditor({
  question,
  onPatch,
  onChangeType,
}: {
  question: SurveyQuestion;
  onPatch: (p: Partial<SurveyQuestion>) => void;
  onChangeType: (t: QuestionType) => void;
}) {
  return (
    <div className="bg-snow border border-parchment rounded-[9.6px] overflow-hidden">
      <header className="px-4 py-2.5 border-b border-parchment">
        <h3 className="text-body font-medium text-ink">질문 {question.order} 편집</h3>
      </header>
      <div className="p-4 flex flex-col gap-4">
        {/* 유형 + 필수 */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-body-sm">
            <span className="text-overline text-dusty">유형</span>
            <select
              value={question.type}
              onChange={(e) => onChangeType(e.target.value as QuestionType)}
              className="px-2.5 py-1.5 bg-vellum border border-onyx/15 rounded-[9.6px] text-ink
                         focus:outline-none focus:ring-2 focus:ring-azure"
            >
              {(Object.keys(TYPE_LABELS) as QuestionType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <span className="text-caption text-dusty">— {TYPE_DESCRIPTIONS[question.type]}</span>
          </label>
          <label className="flex items-center gap-1.5 text-body-sm cursor-pointer">
            <input
              type="checkbox"
              checked={question.required}
              onChange={(e) => onPatch({ required: e.target.checked })}
              className="accent-terra"
            />
            <span className="text-graphite">필수 응답</span>
          </label>
        </div>

        {/* 질문 텍스트 */}
        <div>
          <label className="text-overline text-dusty">질문 내용 *</label>
          <textarea
            value={question.text}
            onChange={(e) => onPatch({ text: e.target.value.slice(0, 500) })}
            placeholder="질문을 자연스러운 한국어 문장으로 작성하세요"
            rows={2}
            className="mt-1 w-full px-3 py-2 bg-vellum border border-onyx/15 rounded-[9.6px]
                       text-body-sm text-ink placeholder:text-stone
                       focus:outline-none focus:ring-2 focus:ring-azure resize-none"
          />
          <p className="text-caption text-stone mt-0.5 text-right tabular-nums">
            {question.text.length}/500
          </p>
        </div>

        {/* 유형별 입력 */}
        {(question.type === "single_choice" || question.type === "multi_choice") && (
          <OptionsEditor
            options={question.options}
            onChange={(opts) => onPatch({ options: opts })}
          />
        )}

        {question.type === "scale" && (
          <ScaleEditor question={question} onPatch={onPatch} />
        )}

        {question.type === "nps" && (
          <p className="text-caption text-graphite bg-azure/20 border border-azure rounded px-3 py-2">
            NPS 점수는 0(전혀 추천 안 함) ~ 10(매우 추천)으로 고정됩니다.
          </p>
        )}

        {question.type === "open_ended" && (
          <p className="text-caption text-graphite bg-azure/20 border border-azure rounded px-3 py-2">
            페르소나가 자유 텍스트로 답변합니다. 추가 설정 없음.
          </p>
        )}
      </div>
    </div>
  );
}

function OptionsEditor({
  options,
  onChange,
}: {
  options: string[];
  onChange: (next: string[]) => void;
}) {
  function update(i: number, v: string) {
    const next = [...options];
    next[i] = v;
    onChange(next);
  }
  function add() {
    if (options.length >= 20) return;
    onChange([...options, ""]);
  }
  function remove(i: number) {
    if (options.length <= 2) return;
    onChange(options.filter((_, idx) => idx !== i));
  }
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <label className="text-overline text-dusty">
          선택지 *<span className="text-stone ml-1">(2~20개)</span>
        </label>
        <button
          type="button"
          onClick={add}
          disabled={options.length >= 20}
          className="text-caption text-graphite px-2 py-0.5 rounded border border-parchment
                     hover:border-terra hover:text-terra disabled:opacity-40"
        >
          + 추가
        </button>
      </div>
      <ul className="space-y-1.5">
        {options.map((o, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="text-caption text-stone font-mono w-6 tabular-nums">{i + 1}.</span>
            <input
              type="text"
              value={o}
              onChange={(e) => update(i, e.target.value.slice(0, 200))}
              placeholder={`선택지 ${i + 1}`}
              className="flex-1 px-2.5 py-1.5 bg-vellum border border-onyx/15 rounded-[9.6px]
                         text-body-sm text-ink placeholder:text-stone
                         focus:outline-none focus:ring-2 focus:ring-azure"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              disabled={options.length <= 2}
              className="text-caption text-graphite hover:text-terra disabled:opacity-30 px-2"
              aria-label={`선택지 ${i + 1} 삭제`}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScaleEditor({
  question,
  onPatch,
}: {
  question: SurveyQuestion;
  onPatch: (p: Partial<SurveyQuestion>) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="text-overline text-dusty">최저값</label>
        <input
          type="number"
          min={0}
          max={9}
          value={question.scale_min ?? 1}
          onChange={(e) => onPatch({ scale_min: Number(e.target.value) })}
          className="mt-1 w-full px-3 py-1.5 bg-vellum border border-onyx/15 rounded-[9.6px] text-body-sm text-ink tabular-nums focus:outline-none focus:ring-2 focus:ring-azure"
        />
        <input
          type="text"
          value={question.scale_label_low ?? ""}
          onChange={(e) => onPatch({ scale_label_low: e.target.value || null })}
          placeholder="라벨 (예: 매우 불만족)"
          maxLength={20}
          className="mt-1.5 w-full px-3 py-1.5 bg-vellum border border-onyx/15 rounded-[9.6px] text-caption text-ink placeholder:text-stone focus:outline-none focus:ring-2 focus:ring-azure"
        />
      </div>
      <div>
        <label className="text-overline text-dusty">최고값</label>
        <input
          type="number"
          min={1}
          max={10}
          value={question.scale_max ?? 5}
          onChange={(e) => onPatch({ scale_max: Number(e.target.value) })}
          className="mt-1 w-full px-3 py-1.5 bg-vellum border border-onyx/15 rounded-[9.6px] text-body-sm text-ink tabular-nums focus:outline-none focus:ring-2 focus:ring-azure"
        />
        <input
          type="text"
          value={question.scale_label_high ?? ""}
          onChange={(e) => onPatch({ scale_label_high: e.target.value || null })}
          placeholder="라벨 (예: 매우 만족)"
          maxLength={20}
          className="mt-1.5 w-full px-3 py-1.5 bg-vellum border border-onyx/15 rounded-[9.6px] text-caption text-ink placeholder:text-stone focus:outline-none focus:ring-2 focus:ring-azure"
        />
      </div>
    </div>
  );
}
