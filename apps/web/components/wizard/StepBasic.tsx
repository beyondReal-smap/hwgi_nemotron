"use client";

import type { WizardState } from "./types";

/**
 * Step 1 — 기본 정보.
 *
 * 입력 3종:
 *  - title (필수, 1-200자)
 *  - description (선택, 0-2000자)
 *  - objective (선택, 0-2000자) — LLM 응답 품질에 활용되니 가급적 작성 권장
 */
export function StepBasic({
  state,
  setState,
}: {
  state: WizardState;
  setState: (s: WizardState) => void;
}) {
  function patch(p: Partial<WizardState["basic"]>) {
    setState({ ...state, basic: { ...state.basic, ...p } });
  }

  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <Field
        label="설문 제목"
        required
        counter={`${state.basic.title.length}/200`}
      >
        <input
          type="text"
          value={state.basic.title}
          onChange={(e) => patch({ title: e.target.value.slice(0, 200) })}
          placeholder="예: 30대 직장인의 점심 식사 만족도"
          className="w-full px-3 py-2.5 bg-snow border border-onyx/15 rounded-[9.6px]
                     text-body text-ink placeholder:text-stone
                     focus:outline-none focus:ring-2 focus:ring-azure focus:border-onyx/30"
          autoFocus
        />
      </Field>

      <Field label="설명" counter={`${state.basic.description.length}/2000`}>
        <textarea
          value={state.basic.description}
          onChange={(e) =>
            patch({ description: e.target.value.slice(0, 2000) })
          }
          placeholder="설문의 배경, 가설, 활용 계획을 자유롭게 적어주세요"
          rows={3}
          className="w-full px-3 py-2 bg-snow border border-onyx/15 rounded-[9.6px]
                     text-body-sm text-ink placeholder:text-stone
                     focus:outline-none focus:ring-2 focus:ring-azure focus:border-onyx/30 resize-none"
        />
      </Field>

      <Field
        label="조사 목적"
        helperText="LLM이 페르소나 응답을 생성할 때 맥락으로 활용합니다. 가급적 작성하시면 응답 품질이 향상됩니다."
        counter={`${state.basic.objective.length}/2000`}
      >
        <textarea
          value={state.basic.objective}
          onChange={(e) => patch({ objective: e.target.value.slice(0, 2000) })}
          placeholder="예: 사내 식당의 메뉴 다양성 부족 가설을 검증하고 개선 우선순위를 파악"
          rows={4}
          className="w-full px-3 py-2 bg-snow border border-onyx/15 rounded-[9.6px]
                     text-body-sm text-ink placeholder:text-stone
                     focus:outline-none focus:ring-2 focus:ring-azure focus:border-onyx/30 resize-none"
        />
      </Field>
    </div>
  );
}

// ============================================================
// 공통 입력 필드
// ============================================================

function Field({
  label,
  required = false,
  helperText,
  counter,
  children,
}: {
  label: string;
  required?: boolean;
  helperText?: string;
  counter?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <label className="text-overline text-dusty">
          {label}
          {required && <span className="text-terra ml-1">*</span>}
        </label>
        {counter && (
          <span className="text-caption text-stone tabular-nums">{counter}</span>
        )}
      </div>
      {children}
      {helperText && (
        <p className="text-caption text-dusty mt-1">{helperText}</p>
      )}
    </div>
  );
}
