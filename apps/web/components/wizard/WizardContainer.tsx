"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WizardShell } from "./WizardShell";
import { StepBasic } from "./StepBasic";
import { StepTargets } from "./StepTargets";
import { StepQuestions } from "./StepQuestions";
import { StepExecution } from "./StepExecution";
import { INITIAL_STATE, type WizardStep, type WizardState } from "./types";
import { createSurvey } from "@/lib/api";

/**
 * 4-step 설문 생성 마법사 컨테이너.
 *
 * `/surveys?mode=new`와 `/surveys/new`(redirect) 양쪽에서 재사용.
 * 제출 시 createSurvey + run 트리거 + /surveys/:id/progress 라우팅.
 */
export function WizardContainer() {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>(1);
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const survey = await createSurvey({
        title: state.basic.title.trim(),
        description: state.basic.description.trim(),
        objective: state.basic.objective.trim(),
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
        execution: state.execution,
        questions: state.questions,
        persona_uuids: state.targets.preview_persona_uuids,
      });

      // run 트리거 — part4 구현됨
      try {
        await fetch(`/api/surveys/${survey.id}/run`, { method: "POST" });
      } catch {
        /* run 실패해도 progress 페이지에서 재시도 가능 */
      }

      router.push(`/surveys/${survey.id}/progress`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  return (
    <>
      {error && (
        <div
          role="alert"
          className="mb-4 bg-terra/10 border border-terra/30 text-ink px-4 py-3 rounded-[9.6px]"
        >
          <p className="font-medium mb-1">설문 생성 실패</p>
          <p className="text-caption text-graphite">{error}</p>
        </div>
      )}

      <WizardShell
        step={step}
        setStep={setStep}
        state={state}
        onSubmit={handleSubmit}
        submitting={submitting}
      >
        {step === 1 && <StepBasic state={state} setState={setState} />}
        {step === 2 && <StepTargets state={state} setState={setState} />}
        {step === 3 && <StepQuestions state={state} setState={setState} />}
        {step === 4 && <StepExecution state={state} setState={setState} />}
      </WizardShell>
    </>
  );
}
