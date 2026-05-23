"use client";

import { useMemo, useState } from "react";
import { suggestQuestions, type QuestionType, type SurveyQuestion } from "@/lib/api";
import { QuestionImportModal } from "./QuestionImportModal";
import type { WizardState } from "./types";
import { ConfirmModal } from "@/components/ConfirmModal";

/**
 * Step 3 — 질문 설계.
 *
 * 좌측: 질문 리스트 (각 카드 = 유형 뱃지 + 텍스트 + ↑↓/편집/삭제)
 * 우측: 선택된 질문 편집 폼 (유형 select + 유형별 입력 + 미리보기)
 *
 * MVP는 화살표 버튼으로 순서 변경. DnD는 Phase 2.
 */

const TYPE_LABELS: Record<QuestionType, string> = {
  single_choice: "단일 선택",
  multi_choice: "다중 선택",
  scale: "척도",
  open_ended: "주관식",
  nps: "NPS",
};

const TYPE_DESCRIPTIONS: Record<QuestionType, string> = {
  single_choice: "여러 선택지 중 하나",
  multi_choice: "여러 선택지 중 N개",
  scale: "1-5 / 1-7 같은 점수 척도",
  open_ended: "자유 텍스트 응답",
  nps: "0-10 추천 의향 지수",
};

function genId(): string {
  // crypto.randomUUID()는 secure context에서만 보장 — non-https / 일부 브라우저 환경에서 미정의.
  // fallback으로 timestamp + random base36 9자.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

function newQuestion(order: number, type: QuestionType = "single_choice"): SurveyQuestion {
  const base: SurveyQuestion = {
    id: genId(),
    order,
    type,
    text: "",
    options: [],
    scale_min: null,
    scale_max: null,
    scale_label_low: null,
    scale_label_high: null,
    required: true,
  };
  // 유형별 기본값
  if (type === "single_choice" || type === "multi_choice") {
    return { ...base, options: ["", ""] };
  }
  if (type === "scale") {
    return { ...base, scale_min: 1, scale_max: 5 };
  }
  if (type === "nps") {
    return { ...base, scale_min: 0, scale_max: 10 };
  }
  return base;
}

export function StepQuestions({
  state,
  setState,
}: {
  state: WizardState;
  setState: (s: WizardState) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    state.questions[0]?.id ?? null,
  );
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiMode, setAiMode] = useState<"append" | "replace">("append");
  const [importOpen, setImportOpen] = useState(false);
  /** 삭제 확인 대상 질문 id. */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const selected = useMemo(
    () => state.questions.find((q) => q.id === selectedId) ?? null,
    [state.questions, selectedId],
  );

  function reorderQuestions(qs: SurveyQuestion[]): SurveyQuestion[] {
    return qs.map((q, i) => ({ ...q, order: i + 1 }));
  }

  function addQuestion() {
    const q = newQuestion(state.questions.length + 1);
    const next = [...state.questions, q];
    setState({ ...state, questions: next });
    setSelectedId(q.id);
  }

  async function runAiSuggest(num: number = 5) {
    setAiLoading(true);
    setAiError(null);
    try {
      const startOrder = aiMode === "append" ? state.questions.length + 1 : 1;
      const existing = aiMode === "append" ? state.questions.map((q) => q.text) : [];
      const r = await suggestQuestions({
        title: state.basic.title,
        description: state.basic.description,
        objective: state.basic.objective,
        target_filter: {
          age_min: state.targets.age_min,
          age_max: state.targets.age_max,
          sex: state.targets.sex,
          provinces: state.targets.provinces,
          family_types: state.targets.family_types,
          education_levels: state.targets.education_levels,
          occupations: state.targets.occupations,
          query: state.targets.query,
          sampling: state.targets.sampling,
          sample_size: state.targets.sample_size,
        },
        num,
        existing_question_texts: existing,
        start_order: startOrder,
      });
      if (r.questions.length === 0) {
        setAiError("추천 결과가 없습니다. 입력 내용을 더 구체적으로 작성해 보세요.");
        return;
      }
      const next =
        aiMode === "append"
          ? reorderQuestions([...state.questions, ...r.questions])
          : reorderQuestions(r.questions);
      setState({ ...state, questions: next });
      setSelectedId(r.questions[0].id);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiLoading(false);
    }
  }

  function handleImportConfirm(
    imported: SurveyQuestion[],
    mode: "append" | "replace",
  ) {
    const next =
      mode === "append"
        ? reorderQuestions([...state.questions, ...imported])
        : reorderQuestions(imported);
    setState({ ...state, questions: next });
    setSelectedId(imported[0]?.id ?? null);
    setImportOpen(false);
  }

  function updateQuestion(id: string, patch: Partial<SurveyQuestion>) {
    const next = state.questions.map((q) => (q.id === id ? { ...q, ...patch } : q));
    setState({ ...state, questions: next });
  }

  function removeQuestion(id: string) {
    const next = reorderQuestions(state.questions.filter((q) => q.id !== id));
    setState({ ...state, questions: next });
    if (selectedId === id) {
      setSelectedId(next[0]?.id ?? null);
    }
  }

  function moveQuestion(id: string, direction: -1 | 1) {
    const idx = state.questions.findIndex((q) => q.id === id);
    if (idx < 0) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= state.questions.length) return;
    const copy = [...state.questions];
    [copy[idx], copy[targetIdx]] = [copy[targetIdx], copy[idx]];
    setState({ ...state, questions: reorderQuestions(copy) });
  }

  function changeType(id: string, type: QuestionType) {
    const q = state.questions.find((x) => x.id === id);
    if (!q) return;
    const fresh = newQuestion(q.order, type);
    updateQuestion(id, {
      type,
      options: fresh.options,
      scale_min: fresh.scale_min,
      scale_max: fresh.scale_max,
      scale_label_low: null,
      scale_label_high: null,
    });
  }

  return (
    <>
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.5fr] gap-5">
      {/* 좌측: 질문 리스트 */}
      <section className="bg-snow border border-parchment rounded-[9.6px] overflow-hidden flex flex-col">
        <header className="px-4 py-2.5 border-b border-parchment flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-body font-medium text-ink">
              질문 ({state.questions.length}개)
            </h3>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setImportOpen(true)}
                className="text-caption text-graphite px-2 py-1 rounded border border-parchment
                           hover:border-terra hover:text-terra transition-colors"
                title="Excel/CSV/Word 파일에서 질문 가져오기"
              >
                ☰ 파일 업로드
              </button>
              <button
                type="button"
                onClick={addQuestion}
                className="text-caption text-graphite px-2 py-1 rounded border border-parchment
                           hover:border-terra hover:text-terra transition-colors"
              >
                + 질문 추가
              </button>
            </div>
          </div>
          {/* AI 추천 컨트롤 */}
          <div className="flex items-center gap-2 pt-2 border-t border-parchment">
            <span className="text-overline text-dusty">AI 추천</span>
            <select
              value={aiMode}
              onChange={(e) => setAiMode(e.target.value as "append" | "replace")}
              disabled={aiLoading}
              className="text-caption px-2 py-1 bg-vellum border border-onyx/15 rounded text-ink
                         focus:outline-none focus:ring-2 focus:ring-azure"
            >
              <option value="append">기존에 추가</option>
              <option value="replace">전체 교체</option>
            </select>
            <button
              type="button"
              onClick={() => runAiSuggest(5)}
              disabled={aiLoading}
              className="text-caption font-medium px-3 py-1 rounded bg-ink text-snow
                         hover:bg-onyx active:bg-graphite transition-colors
                         disabled:opacity-40 disabled:cursor-not-allowed ml-auto"
            >
              {aiLoading ? "추천 중…" : "5문항 자동 생성"}
            </button>
          </div>
          {aiError && (
            <p className="text-caption text-ink bg-terra/10 border border-terra/30 rounded px-2 py-1">
              {aiError}
            </p>
          )}
        </header>

        {state.questions.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-body-sm text-graphite mb-3">아직 질문이 없습니다</p>
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={addQuestion}
                className="px-4 py-2 text-body-sm font-medium text-snow bg-ink rounded-[9.6px]
                           hover:bg-onyx transition-colors"
              >
                첫 질문 직접 추가
              </button>
              <span className="text-caption text-stone">또는</span>
              <div className="flex flex-col sm:flex-row items-center gap-2">
                <button
                  type="button"
                  onClick={() => runAiSuggest(5)}
                  disabled={aiLoading}
                  className="px-4 py-2 text-body-sm font-medium text-graphite bg-snow border border-parchment rounded-[9.6px]
                             hover:border-terra hover:text-terra transition-colors
                             disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {aiLoading ? "AI가 추천 중…" : "AI에게 5문항 자동 생성"}
                </button>
                <button
                  type="button"
                  onClick={() => setImportOpen(true)}
                  className="px-4 py-2 text-body-sm font-medium text-graphite bg-snow border border-parchment rounded-[9.6px]
                             hover:border-terra hover:text-terra transition-colors"
                >
                  ☰ 파일에서 가져오기
                </button>
              </div>
              <p className="text-caption text-dusty mt-2 max-w-xs">
                AI 추천은 Step 1·2 정보를 활용. 파일은 Excel/CSV/Word 지원
              </p>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-parchment max-h-[600px] overflow-auto">
            {state.questions.map((q, i) => {
              const isSel = selectedId === q.id;
              return (
                <li key={q.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(q.id)}
                    className={`w-full text-left px-4 py-3 transition-colors ${
                      isSel
                        ? "bg-vellum border-l-4 border-l-terra"
                        : "hover:bg-vellum/60 border-l-4 border-l-transparent"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <div className="flex items-baseline gap-2 min-w-0">
                        <span className="text-caption text-stone font-mono tabular-nums shrink-0">
                          {q.order}.
                        </span>
                        <span className="text-caption text-terra px-1.5 py-0.5 bg-snow border border-terra/30 rounded shrink-0">
                          {TYPE_LABELS[q.type]}
                        </span>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <IconButton
                          label="위로"
                          disabled={i === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            moveQuestion(q.id, -1);
                          }}
                        >
                          ↑
                        </IconButton>
                        <IconButton
                          label="아래로"
                          disabled={i === state.questions.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            moveQuestion(q.id, 1);
                          }}
                        >
                          ↓
                        </IconButton>
                        <IconButton
                          label="삭제"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(q.id);
                          }}
                        >
                          ✕
                        </IconButton>
                      </div>
                    </div>
                    <p className="text-body-sm text-ink line-clamp-2">
                      {q.text || (
                        <span className="text-stone italic">질문 내용을 입력하세요</span>
                      )}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 우측: 편집 + 미리보기 */}
      <section className="flex flex-col gap-4">
        {selected ? (
          <>
            <QuestionEditor
              question={selected}
              onPatch={(p) => updateQuestion(selected.id, p)}
              onChangeType={(t) => changeType(selected.id, t)}
            />
            <QuestionPreview question={selected} />
          </>
        ) : (
          <div className="bg-snow border border-parchment rounded-[9.6px] p-8 text-center">
            <p className="text-body-sm text-graphite">왼쪽에서 질문을 선택하거나 추가하세요</p>
          </div>
        )}
      </section>
    </div>

    <QuestionImportModal
      open={importOpen}
      onClose={() => setImportOpen(false)}
      onConfirm={handleImportConfirm}
      hasExistingQuestions={state.questions.length > 0}
    />

    {/* 질문 삭제 확인 모달 */}
    <ConfirmModal
      open={confirmDeleteId !== null}
      title="이 질문을 삭제할까요?"
      description="삭제 후에는 되돌릴 수 없습니다."
      confirmLabel="삭제"
      cancelLabel="취소"
      tone="danger"
      onConfirm={() => {
        if (confirmDeleteId) {
          removeQuestion(confirmDeleteId);
          setConfirmDeleteId(null);
        }
      }}
      onCancel={() => setConfirmDeleteId(null)}
    />
    </>
  );
}

// ============================================================
// 질문 편집기
// ============================================================

function QuestionEditor({
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

// ============================================================
// 미리보기 — 실제 페르소나가 받게 될 폼 시뮬레이션
// ============================================================

function QuestionPreview({ question }: { question: SurveyQuestion }) {
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

// ============================================================
// 보조
// ============================================================

function IconButton({
  label,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center justify-center w-6 h-6 text-caption text-graphite
                 hover:text-terra hover:bg-vellum rounded transition-colors
                 disabled:opacity-30 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}
