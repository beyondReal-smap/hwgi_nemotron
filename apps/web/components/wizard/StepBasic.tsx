"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchSurveyPlaceholders, type SurveyPlaceholders } from "@/lib/api";

import type { WizardState } from "./types";

// LLM 생성에 실패했을 때만 쓰는 고정 fallback (정상 로드 시엔 노출되지 않음)
const FALLBACK: SurveyPlaceholders = {
  title: "30대 직장인의 점심 식사 만족도",
  description: "사내 식당 메뉴 다양성 부족 가설을 검증",
  objective: "메뉴 다양성·가격·접근성 중 만족도를 좌우하는 핵심 요인을 파악",
};

type BasicField = "title" | "description" | "objective";

/**
 * Step 1 — 기본 정보.
 *
 * 입력 3종:
 *  - title (필수, 1-200자)
 *  - description (선택, 0-2000자)
 *  - objective (선택, 0-2000자) — LLM 응답 품질에 활용되니 가급적 작성 권장
 *
 * placeholder는 마운트 시 LLM이 매번 다른 분야의 예시 1세트를 생성해 채운다.
 * 생성 전에는 placeholder 자리에 로딩 스켈레톤을 표시하고, 완료 후에만 예시를 노출한다.
 * 빈 칸에서 Tab을 누르면 보이는 예시가 그대로 값으로 입력된다(자동완성 수락).
 */
export function StepBasic({
  state,
  setState,
}: {
  state: WizardState;
  setState: (s: WizardState) => void;
}) {
  const [ph, setPh] = useState<SurveyPlaceholders | null>(null);
  const [loadingPh, setLoadingPh] = useState(true);

  const loadPh = useCallback(async () => {
    setLoadingPh(true);
    try {
      setPh(await fetchSurveyPlaceholders());
    } catch {
      setPh(FALLBACK); // 실패 시에만 고정 예시로 폴백
    } finally {
      setLoadingPh(false);
    }
  }, []);

  useEffect(() => {
    loadPh();
  }, [loadPh]);

  function patch(p: Partial<WizardState["basic"]>) {
    setState({ ...state, basic: { ...state.basic, ...p } });
  }

  // '예시 새로 생성': 기존 입력값을 비우고 LLM 추천 예시를 새로 받아 placeholder로 노출한다.
  // (입력값이 남아 있으면 placeholder가 가려져 새 예시가 보이지 않으므로 함께 초기화)
  async function regenerate() {
    patch({ title: "", description: "", objective: "" });
    await loadPh();
  }

  const shown = ph ?? FALLBACK;

  // 빈 칸에서 Tab → 보이는 예시를 그대로 입력하고 포커스는 유지(자동완성 수락 패턴).
  // 이미 입력값이 있거나 예시 로딩 중이면 가로채지 않고 일반 Tab(포커스 이동)으로 둔다.
  function acceptExampleOnTab(
    e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    field: BasicField,
  ) {
    if (
      e.key === "Tab" &&
      !e.shiftKey &&
      !loadingPh &&
      state.basic[field] === ""
    ) {
      e.preventDefault();
      patch({ [field]: shown[field] });
    }
  }

  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <div className="flex items-center justify-between -mb-2">
        <span className="text-caption text-dusty">
          빈 칸에서 <kbd className="px-1 py-0.5 bg-onyx/5 border border-onyx/15 rounded text-[11px] text-ink">Tab</kbd> 을 누르면 예시가 그대로 입력됩니다
        </span>
        <button
          type="button"
          onClick={regenerate}
          disabled={loadingPh}
          className="inline-flex items-center gap-1 text-caption font-semibold text-terra
                     hover:text-terra/75 disabled:text-stone disabled:cursor-default
                     transition-colors"
          title="기존 입력을 지우고 입력 예시를 다른 주제로 새로 생성합니다"
        >
          <span className={loadingPh ? "animate-spin" : ""} aria-hidden>
            ↻
          </span>
          {loadingPh ? "예시 생성 중…" : "예시 새로 생성"}
        </button>
      </div>

      <Field
        id="wizard-basic-title"
        label="설문 제목"
        required
        counter={`${state.basic.title.length}/200`}
      >
        <PlaceholderHost loading={loadingPh} empty={state.basic.title === ""} top="center">
          <input
            id="wizard-basic-title"
            type="text"
            value={state.basic.title}
            onChange={(e) => patch({ title: e.target.value.slice(0, 200) })}
            onKeyDown={(e) => acceptExampleOnTab(e, "title")}
            placeholder={loadingPh ? "" : `예: ${shown.title}`}
            className="w-full px-3 py-2.5 bg-snow border border-onyx/15 rounded-[9.6px]
                       text-body text-ink placeholder:text-stone
                       focus:outline-none focus:ring-2 focus:ring-azure focus:border-onyx/30"
            autoFocus
          />
        </PlaceholderHost>
      </Field>

      <Field
        id="wizard-basic-description"
        label="설명"
        counter={`${state.basic.description.length}/2000`}
      >
        <PlaceholderHost loading={loadingPh} empty={state.basic.description === ""} top="textarea">
          <textarea
            id="wizard-basic-description"
            value={state.basic.description}
            onChange={(e) =>
              patch({ description: e.target.value.slice(0, 2000) })
            }
            onKeyDown={(e) => acceptExampleOnTab(e, "description")}
            placeholder={loadingPh ? "" : `예: ${shown.description}`}
            rows={3}
            className="w-full px-3 py-2 bg-snow border border-onyx/15 rounded-[9.6px]
                       text-body-sm text-ink placeholder:text-stone
                       focus:outline-none focus:ring-2 focus:ring-azure focus:border-onyx/30 resize-none"
          />
        </PlaceholderHost>
      </Field>

      <Field
        id="wizard-basic-objective"
        label="조사 목적"
        helperText="LLM이 페르소나 응답을 생성할 때 맥락으로 활용합니다. 가급적 작성하시면 응답 품질이 향상됩니다."
        counter={`${state.basic.objective.length}/2000`}
      >
        <PlaceholderHost loading={loadingPh} empty={state.basic.objective === ""} top="textarea">
          <textarea
            id="wizard-basic-objective"
            value={state.basic.objective}
            onChange={(e) => patch({ objective: e.target.value.slice(0, 2000) })}
            onKeyDown={(e) => acceptExampleOnTab(e, "objective")}
            placeholder={loadingPh ? "" : `예: ${shown.objective}`}
            rows={4}
            className="w-full px-3 py-2 bg-snow border border-onyx/15 rounded-[9.6px]
                       text-body-sm text-ink placeholder:text-stone
                       focus:outline-none focus:ring-2 focus:ring-azure focus:border-onyx/30 resize-none"
          />
        </PlaceholderHost>
      </Field>
    </div>
  );
}

// ============================================================
// placeholder 자리에 로딩 스켈레톤을 겹쳐 보여주는 래퍼
// (입력값이 있으면 스켈레톤을 감춰 타이핑을 방해하지 않음)
// ============================================================

function PlaceholderHost({
  loading,
  empty,
  top,
  children,
}: {
  loading: boolean;
  empty: boolean;
  top: "center" | "textarea";
  children: React.ReactNode;
}) {
  const show = loading && empty;
  return (
    <div className="relative">
      {children}
      {show && (
        <div
          className={`absolute left-3 right-3 flex flex-col gap-1.5 pointer-events-none ${
            top === "center" ? "inset-y-0 justify-center" : "top-2.5"
          }`}
          aria-hidden
        >
          <SkeletonLine className="w-3/5" />
          {top === "textarea" && <SkeletonLine className="w-2/5" />}
        </div>
      )}
    </div>
  );
}

function SkeletonLine({ className = "" }: { className?: string }) {
  return <div className={`h-2.5 rounded bg-onyx/10 animate-pulse ${className}`} />;
}

// ============================================================
// 공통 입력 필드
// ============================================================

function Field({
  id,
  label,
  required = false,
  helperText,
  counter,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  helperText?: string;
  counter?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <label className="text-overline text-dusty" htmlFor={id}>
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
