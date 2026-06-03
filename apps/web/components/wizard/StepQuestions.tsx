"use client";

import { useMemo, useState } from "react";
import { suggestQuestions, type QuestionType, type SurveyQuestion } from "@/lib/api";
import { QuestionImportModal } from "./QuestionImportModal";
import { QuestionEditor } from "./QuestionEditor";
import { QuestionPreview } from "./QuestionPreview";
import { TYPE_LABELS, newQuestion, reorderQuestions } from "./questionUtils";
import type { WizardState } from "./types";
import { ConfirmModal } from "@/components/ConfirmModal";

/**
 * Step 3 — 질문 설계 (컨테이너).
 *
 * 좌측: 질문 리스트 (각 카드 = 유형 뱃지 + 텍스트 + ↑↓/편집/삭제)
 * 우측: 선택된 질문 편집 폼(QuestionEditor) + 미리보기(QuestionPreview)
 *
 * 편집 폼·미리보기·공통 유틸은 별도 파일로 분리(QuestionEditor / QuestionPreview /
 * questionUtils). 이 컴포넌트는 질문 배열 상태와 리스트 조작만 담당한다.
 * MVP는 화살표 버튼으로 순서 변경. DnD는 Phase 2.
 */

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
            <p role="alert" className="text-caption text-ink bg-terra/10 border border-terra/30 rounded px-2 py-1">
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
                      isSel ? "bg-vellum" : "hover:bg-vellum/60"
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
                          label="질문 위로 이동"
                          disabled={i === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            moveQuestion(q.id, -1);
                          }}
                        >
                          ↑
                        </IconButton>
                        <IconButton
                          label="질문 아래로 이동"
                          disabled={i === state.questions.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            moveQuestion(q.id, 1);
                          }}
                        >
                          ↓
                        </IconButton>
                        <IconButton
                          label="질문 삭제"
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
// 보조 — 리스트 아이템의 ↑↓/삭제 아이콘 버튼
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
      className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] text-caption text-graphite
                 hover:text-terra hover:bg-vellum rounded transition-colors
                 disabled:opacity-30 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}
