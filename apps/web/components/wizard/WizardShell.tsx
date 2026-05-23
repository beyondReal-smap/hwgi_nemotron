"use client";

import { useEffect, useRef, useState } from "react";
import type { WizardStep, WizardState } from "./types";
import { validateStep } from "./types";

/**
 * 설문 생성 마법사 공통 셸.
 *
 * 구성:
 *  - 상단 stepper (4단계 인디케이터)
 *  - 본문 (각 Step 컴포넌트가 children으로 주입됨)
 *  - 하단 액션 바 (이전/다음 또는 시뮬레이션 시작)
 *  - 단계별 validation 실패 시 토스트
 */
export function WizardShell({
  step,
  setStep,
  state,
  onSubmit,
  submitting,
  children,
}: {
  step: WizardStep;
  setStep: (s: WizardStep) => void;
  state: WizardState;
  onSubmit: () => Promise<void>;
  submitting: boolean;
  children: React.ReactNode;
}) {
  const currentValid = validateStep(state, step);
  const isLast = step === 4;

  // 직전 step과 비교해 진행 방향을 결정 (다음 단계 → 오른쪽에서, 이전 단계 → 왼쪽에서)
  const prevStepRef = useRef<WizardStep>(step);
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  useEffect(() => {
    if (step > prevStepRef.current) setDirection("forward");
    else if (step < prevStepRef.current) setDirection("backward");
    prevStepRef.current = step;
  }, [step]);

  function handleNext() {
    if (!currentValid.ok) return;
    if (isLast) {
      onSubmit();
    } else {
      setStep((step + 1) as WizardStep);
    }
  }
  function handlePrev() {
    if (step > 1) setStep((step - 1) as WizardStep);
  }

  return (
    <section className="bg-vellum border border-parchment rounded-[9.6px] overflow-hidden flex flex-col">
      {/* 헤더 + Stepper */}
      <header className="bg-snow border-b border-parchment border-l-4 border-l-terra px-5 py-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-title text-ink">설문 만들기</h2>
            <p className="text-body-sm text-dusty mt-1">
              4단계로 설문지를 만들고 시뮬레이션을 시작합니다
            </p>
          </div>
        </div>
        <Stepper step={step} setStep={setStep} state={state} />
      </header>

      {/* 본문 — 각 Step 컴포넌트, step 변경 시 방향성 fade-slide */}
      <div className="p-5 lg:p-6">
        <div
          key={step}
          className={
            direction === "forward"
              ? "anim-fade-slide-right"
              : "anim-fade-slide-left"
          }
        >
          {children}
        </div>
      </div>

      {/* 하단 액션 바 */}
      <footer className="sticky bottom-0 z-20 px-5 py-4 border-t border-parchment bg-snow/95 backdrop-blur shadow-[0_-4px_16px_-8px_rgba(20,20,19,0.12)] flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0 text-caption text-graphite">
          {!currentValid.ok && (
            <span className="text-terra">⚠ {currentValid.reason}</span>
          )}
          {currentValid.ok && !isLast && (
            <span className="text-dusty">다음 단계로 진행 가능합니다</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handlePrev}
            disabled={step === 1 || submitting}
            className="px-4 py-2 text-body-sm text-graphite bg-snow border border-parchment rounded-[9.6px]
                       hover:border-terra hover:text-terra hover:-translate-x-[1px]
                       active:translate-x-0 active:scale-[0.98]
                       transition-[color,border-color,transform] duration-200 ease-out
                       motion-reduce:hover:translate-x-0 motion-reduce:active:scale-100
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            이전
          </button>
          <button
            type="button"
            onClick={handleNext}
            disabled={!currentValid.ok || submitting}
            className="px-5 py-2 text-body-sm font-medium text-snow bg-ink rounded-[9.6px]
                       hover:bg-onyx active:bg-graphite
                       hover:translate-x-[1px] active:translate-x-0 active:scale-[0.98]
                       transition-[background-color,transform] duration-200 ease-out
                       motion-reduce:hover:translate-x-0 motion-reduce:active:scale-100
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting
              ? "시뮬레이션 시작 중…"
              : isLast
                ? "시뮬레이션 시작 →"
                : "다음"}
          </button>
        </div>
      </footer>
    </section>
  );
}

// ============================================================
// Stepper — 4 step 인디케이터
// ============================================================

const STEP_LABELS: Record<WizardStep, string> = {
  1: "기본 정보",
  2: "대상자 선별",
  3: "질문 설계",
  4: "실행 설정",
};

function Stepper({
  step,
  setStep,
  state,
}: {
  step: WizardStep;
  setStep: (s: WizardStep) => void;
  state: WizardState;
}) {
  const steps: WizardStep[] = [1, 2, 3, 4];
  const activeRef = useRef<HTMLButtonElement>(null);

  // step 변경 시 모바일 가로 스크롤에서 active 단계가 보이도록
  useEffect(() => {
    activeRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [step]);

  return (
    <ol
      className="flex items-center gap-1 overflow-x-auto -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label="진행 단계"
    >
      {steps.map((s, idx) => {
        const active = s === step;
        const completed = s < step;
        // 이전 단계는 자유롭게 돌아갈 수 있음. 미래 단계는 validate 통과한 경우만
        const reachable = s <= step || validateStep(state, (s - 1) as WizardStep).ok;
        return (
          <li key={s} className="flex items-center gap-1 shrink-0">
            <button
              ref={active ? activeRef : null}
              type="button"
              onClick={() => reachable && setStep(s)}
              disabled={!reachable}
              aria-label={`${s}단계: ${STEP_LABELS[s]}`}
              className={`group flex items-center gap-2 min-h-[40px] px-2 sm:px-3 py-1.5 rounded-[9.6px]
                          transition-[background-color,border-color,color,transform] duration-200 ease-out
                          disabled:cursor-not-allowed
                          enabled:hover:-translate-y-[1px] active:translate-y-0
                          motion-reduce:enabled:hover:translate-y-0
                          ${
                            active
                              ? "bg-vellum border border-parchment text-ink"
                              : completed
                                ? "text-graphite hover:text-ink"
                                : "text-stone"
                          }`}
              aria-current={active ? "step" : undefined}
            >
              <span
                key={`${s}-${completed ? "done" : active ? "active" : "idle"}`}
                className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-caption font-medium tabular-nums
                            transition-[background-color,color,box-shadow,transform] duration-200 ease-out
                            ${
                              active
                                ? "bg-terra text-snow shadow-[0_0_0_3px_rgba(217,119,87,0.15)] anim-indicator-pop"
                                : completed
                                  ? "bg-graphite text-snow"
                                  : "bg-parchment text-dusty"
                            }`}
              >
                {completed ? "✓" : s}
              </span>
              <span
                className={`text-body-sm transition-[font-weight,color] duration-200 ${
                  active ? "font-medium text-ink" : ""
                } ${
                  /* 모바일: active만 라벨, 그 외는 숨김. sm+에서는 모두 노출 */
                  active ? "inline" : "hidden sm:inline"
                }`}
              >
                {STEP_LABELS[s]}
              </span>
            </button>
            {idx < steps.length - 1 && (
              <span
                aria-hidden
                className={`transition-colors duration-200 ${
                  s < step ? "text-terra" : "text-stone"
                }`}
              >
                →
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
