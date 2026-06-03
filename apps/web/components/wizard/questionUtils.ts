import type { QuestionType, SurveyQuestion } from "@/lib/api";

/** 질문 유형 → 표시 라벨 (리스트 뱃지 · 편집기 select 공용). */
export const TYPE_LABELS: Record<QuestionType, string> = {
  single_choice: "단일 선택",
  multi_choice: "다중 선택",
  scale: "척도",
  open_ended: "주관식",
  nps: "NPS",
};

/** 질문 유형 → 한 줄 설명 (편집기 보조 텍스트). */
export const TYPE_DESCRIPTIONS: Record<QuestionType, string> = {
  single_choice: "여러 선택지 중 하나",
  multi_choice: "여러 선택지 중 N개",
  scale: "1-5 / 1-7 같은 점수 척도",
  open_ended: "자유 텍스트 응답",
  nps: "0-10 추천 의향 지수",
};

export function genId(): string {
  // crypto.randomUUID()는 secure context에서만 보장 — non-https / 일부 브라우저 환경에서 미정의.
  // fallback으로 timestamp + random base36 9자.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

export function newQuestion(
  order: number,
  type: QuestionType = "single_choice",
): SurveyQuestion {
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

/** order 필드를 배열 인덱스 기준(1-base)으로 재부여. */
export function reorderQuestions(qs: SurveyQuestion[]): SurveyQuestion[] {
  return qs.map((q, i) => ({ ...q, order: i + 1 }));
}
