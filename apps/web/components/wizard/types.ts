/**
 * 설문 생성 마법사 — 공유 타입.
 *
 * /surveys/new/page.tsx에서 단일 WizardState로 4 step의 상태를 보관한다.
 * 제출 시 SurveyCreateRequest로 변환하여 createSurvey() 호출.
 */

import type {
  ExecutionConfig,
  SurveyQuestion,
  TargetFilter,
} from "@/lib/api";

export type WizardStep = 1 | 2 | 3 | 4;

export type WizardState = {
  // Step 1
  basic: {
    title: string;
    description: string;
    objective: string;
  };
  // Step 2 — TargetFilter + 미리보기 데이터 (UI 전용)
  targets: TargetFilter & {
    /** 미리보기 시 받은 페르소나 uuid (제출 시 persona_uuids로 전달) */
    preview_persona_uuids: string[];
    /** 미리보기 메타 — 사용자 확인용 */
    preview_total: number;
    /** 미리보기 분포 — UI 표시용 */
    preview_distribution: {
      sex: Record<string, number>;
      age_bins: { label: string; count: number }[];
      province: Record<string, number>;
    };
    /** 불러온 세그먼트 id (있으면 표시) */
    loaded_segment_id: string | null;
  };
  // Step 3
  questions: SurveyQuestion[];
  // Step 4
  execution: ExecutionConfig;
};

export const INITIAL_STATE: WizardState = {
  basic: { title: "", description: "", objective: "" },
  targets: {
    age_min: null,
    age_max: null,
    sex: [],
    provinces: [],
    family_types: [],
    education_levels: [],
    occupations: [],
    query: null,
    sampling: "random_n",
    sample_size: 100,
    preview_persona_uuids: [],
    preview_total: 0,
    preview_distribution: { sex: {}, age_bins: [], province: {} },
    loaded_segment_id: null,
  },
  questions: [],
  execution: {
    llm_provider: "sllm",
    model: "Qwen3.6-27B-FP8",
    temperature: 0.7,
    include_reasoning: true,
  },
};

/** 단계별 진행 가능 여부 판정 (다음 버튼 활성화 조건). */
export function validateStep(state: WizardState, step: WizardStep): { ok: boolean; reason?: string } {
  if (step === 1) {
    const t = state.basic.title.trim();
    if (t.length < 1) return { ok: false, reason: "설문 제목을 입력하세요" };
    if (t.length > 200) return { ok: false, reason: "제목은 200자 이내로 입력하세요" };
    return { ok: true };
  }
  if (step === 2) {
    if (state.targets.preview_persona_uuids.length === 0) {
      return { ok: false, reason: "대상자를 1명 이상 확정하세요" };
    }
    if (state.targets.sample_size < 1) return { ok: false, reason: "샘플 크기를 1 이상으로" };
    return { ok: true };
  }
  if (step === 3) {
    if (state.questions.length === 0) return { ok: false, reason: "질문을 1개 이상 추가하세요" };
    for (const q of state.questions) {
      if (!q.text.trim()) return { ok: false, reason: `질문 ${q.order}번 내용이 비어 있습니다` };
      if (q.type === "single_choice" || q.type === "multi_choice") {
        if (q.options.length < 2) {
          return { ok: false, reason: `질문 ${q.order}번 선택지가 2개 미만입니다` };
        }
      }
      if (q.type === "scale") {
        if (q.scale_min === null || q.scale_max === null || q.scale_min >= q.scale_max) {
          return { ok: false, reason: `질문 ${q.order}번 척도 범위가 올바르지 않습니다` };
        }
      }
    }
    return { ok: true };
  }
  if (step === 4) {
    if (state.execution.temperature < 0 || state.execution.temperature > 2) {
      return { ok: false, reason: "temperature는 0~2 사이" };
    }
    return { ok: true };
  }
  return { ok: true };
}
