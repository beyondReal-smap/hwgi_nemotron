/**
 * FastAPI 백엔드 (apps/api) 응답 타입 + fetch 클라이언트.
 *
 * 백엔드의 apps/api/models/schemas.py와 1:1 대응.
 * 변경 시 양쪽 동기화 필수.
 */

export type SellingPoints = {
  summary: string;
  key_benefits: string[];
  target_age_min: number | null;
  target_age_max: number | null;
  target_sex: string[];
  target_family_types: string[];
  target_education_levels: string[];
  target_occupations: string[];
  target_keywords: string[];
  persona_category_weights: Record<string, number>;
};

export type PersonaHit = {
  uuid: string;
  score: number;
  persona: string;
  province: string;
  district: string;
  sex: string;
  age: number;
  occupation: string;
  education_level: string | null;
  family_type: string | null;
  marital_status: string | null;
  military_status: string | null;
};

export type RegionStat = {
  name: string;
  count: number;
  avg_score: number;
  top_persona_uuid: string | null;
};

export type CohortStat = {
  name: string;          // "core" | "target" | "interest"
  label: string;         // 표시용
  percentile: number;
  size: number;
  min_score: number;
  avg_score: number;
};

export type DistributionBin = {
  label: string;
  count: number;
};

export type DemographicGroup = {
  column: string;        // 원본 컬럼명 (sex, marital_status, ...)
  label: string;         // 표시용 라벨
  bins: DistributionBin[];
  total_unique: number;
  truncated_to: number | null;
};

export type PopulationStats = {
  total_scored: number;
  cohorts: CohortStat[];
  score_distribution: DistributionBin[];
  demographics: DemographicGroup[];
  /** 타겟 cohort 기준 전국 시군구 집계 (지도/Top10 표용). name 형식: "시도-시군구". */
  districts_full: RegionStat[];
};

export type PersonaOpinion = {
  persona_uuid: string;
  opinion_text: string;
  sentiment: "긍정" | "중립" | "부정";
  purchase_intent: number; // 1-5
  key_concern: string | null;
};

export type AnalyzeResponse = {
  analysis_id: string;
  selling_points: SellingPoints;
  top_personas: PersonaHit[];
  bottom_personas: PersonaHit[];
  province_stats: RegionStat[];
  district_stats: RegionStat[];
  population_stats: PopulationStats;
  top_opinions: PersonaOpinion[];
  bottom_opinions: PersonaOpinion[];
  report_md: string;
  elapsed_ms: Record<string, number>;
};

// 빈 문자열 = 동일 오리진 (Next.js rewrites가 /api/* → FastAPI 5102로 프록시).
// 외부 호스트에서 직접 FastAPI를 호출해야 할 때만 NEXT_PUBLIC_API_BASE_URL 설정.
const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

// ============================================================
// LLM provider 선택 (analyze · simulate 양쪽에서 공유)
// ============================================================

export type LLMProvider = "anthropic" | "sllm";

// 기본 표시 순서를 sLLM 우선으로 (사내 무료, 빠름)
export const LLM_PROVIDER_OPTIONS: Array<{
  value: LLMProvider;
  label: string;
  sub: string;
}> = [
  { value: "sllm", label: "sLLM", sub: "vLLM Qwen3.6-27B-FP8 (사내·무료)" },
  { value: "anthropic", label: "Claude", sub: "Anthropic Sonnet · Haiku" },
];

const LLM_PROVIDER_STORAGE_KEY = "personafit:llm-provider";

export function loadLLMProvider(): LLMProvider {
  if (typeof window === "undefined") return "sllm";
  const v = window.localStorage.getItem(LLM_PROVIDER_STORAGE_KEY);
  return v === "anthropic" ? "anthropic" : "sllm";
}

export function saveLLMProvider(p: LLMProvider): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LLM_PROVIDER_STORAGE_KEY, p);
}

export async function analyzeProduct(
  productText: string,
  topK = 20,
  llmProvider: LLMProvider = "sllm",
): Promise<AnalyzeResponse> {
  const res = await fetch(`${BASE_URL}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      product_text: productText,
      top_k: topK,
      llm_provider: llmProvider,
    }),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = `${detail} — ${body.detail}`;
    } catch {
      // 응답 본문이 JSON이 아닐 수 있음. 그대로 진행.
    }
    throw new Error(`분석 실패: ${detail}`);
  }

  return res.json();
}

// ============================================================
// 분석 이력
// ============================================================

export type AnalysisSummary = {
  id: string;
  created_at: string;
  summary: string;
  key_benefits: string[];
  max_score: number;
  top_persona_count: number;
  top_province: string | null;
  top_province_count: number;
  total_ms: number;
  simulation_count: number;
};

export type AnalysesListResponse = {
  total: number;
  items: AnalysisSummary[];
};

export async function listAnalyses(
  limit = 50,
  offset = 0,
): Promise<AnalysesListResponse> {
  const res = await fetch(
    `${BASE_URL}/api/analyses?limit=${limit}&offset=${offset}`,
  );
  if (!res.ok) throw new Error(`이력 조회 실패: HTTP ${res.status}`);
  return res.json();
}

// 시뮬레이션 레코드 (영속화된 형태)
export type StoredSimulation = {
  id: string;
  created_at: string;
  analysis_id: string;
  question: string;
  n_respondents: number;
  responses: PersonaResponse[];
  elapsed_ms: Record<string, number>;
};

// 단건 상세는 AnalyzeResponse 형태 + 추가 메타(product_text 일부) + 과거 시뮬레이션
export type AnalysisDetail = AnalyzeResponse & {
  id: string;
  created_at: string;
  product_text?: string;
  simulations?: StoredSimulation[];
};

export async function getAnalysis(id: string): Promise<AnalysisDetail> {
  const res = await fetch(`${BASE_URL}/api/analyses/${id}`);
  if (!res.ok) throw new Error(`이력 상세 실패: HTTP ${res.status}`);
  return res.json();
}

/** 단건 삭제 — 연관 시뮬레이션도 함께 정리됨. */
export async function deleteAnalysis(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/analyses/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = `${detail} — ${body.detail}`;
    } catch {
      // JSON 아닐 수 있음
    }
    throw new Error(`이력 삭제 실패: ${detail}`);
  }
}

/** 전체 삭제 — 분석·시뮬레이션 모두 비움. 되돌릴 수 없음. */
export async function deleteAllAnalyses(): Promise<{
  analyses: number;
  simulations: number;
}> {
  const res = await fetch(`${BASE_URL}/api/analyses`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`전체 삭제 실패: HTTP ${res.status}`);
  return res.json();
}

// ============================================================
// 설문 응답 시뮬레이션
// ============================================================

export type SimulateRequest = {
  analysis_id: string;
  question: string;
  n_respondents: 3 | 5 | 10;
};

export type PersonaResponse = {
  persona_uuid: string;
  persona_summary: string;
  response_text: string;
  sentiment: "긍정" | "중립" | "부정";
  purchase_intent: number; // 1-5
  key_concern: string | null;
};

export type SimulateResponse = {
  simulation_id: string;
  analysis_id: string;
  question: string;
  responses: PersonaResponse[];
  elapsed_ms: Record<string, number>;
};

export async function simulateSurvey(
  analysisId: string,
  question: string,
  nRespondents: number,
  llmProvider: LLMProvider = "sllm",
): Promise<SimulateResponse> {
  const res = await fetch(`${BASE_URL}/api/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      analysis_id: analysisId,
      question,
      n_respondents: nRespondents,
      llm_provider: llmProvider,
    }),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = `${detail} — ${body.detail}`;
    } catch {
      // JSON 아닐 수 있음
    }
    throw new Error(`시뮬레이션 실패: ${detail}`);
  }

  return res.json();
}

// ============================================================
// 데이터셋 현황 (100만 행 메타 통계)
// ============================================================

export type DatasetMeta = {
  total_rows: number;
  total_provinces: number;
  total_districts: number;
  total_occupations: number;
  embedding_dim: number;
  embedding_rows: number;
  source: string;
  license: string;
};

export type AgeStats = {
  min: number;
  max: number;
  mean: number;
  median: number;
  histogram: DistributionBin[];
};

export type DemographicColumn = {
  column: string;
  label: string;
  bins: DistributionBin[];
};

export type ProvinceRow = {
  province: string;
  count: number;
  district_count: number;
  avg_age: number;
  female_ratio: number;
};

export type DistrictRow = {
  district: string; // "서울-강남구"
  province: string;
  name: string;
  count: number;
};

export type PersonaTextStat = {
  column: string;
  label: string;
  mean: number;
  min: number;
  max: number;
};

export type OccupationGroup = {
  group: string;
  count: number;
  ratio: number;          // 0~1
  top_jobs: DistributionBin[];  // 그룹 내 Top 5
};

export type DatasetOverview = {
  meta: DatasetMeta;
  age: AgeStats;
  demographics: DemographicColumn[];
  occupations_top: DistributionBin[];
  occupations_grouped: OccupationGroup[];
  provinces: ProvinceRow[];
  /** 252개 전체 시군구 (지도 색칠용). count 내림차순. */
  districts_top: DistrictRow[];
  persona_text_stats: PersonaTextStat[];
};

export async function getDatasetOverview(): Promise<DatasetOverview> {
  const res = await fetch(`${BASE_URL}/api/dataset/overview`);
  if (!res.ok) throw new Error(`현황 조회 실패: HTTP ${res.status}`);
  return res.json();
}

// ============================================================
// 페르소나 샘플 + 자연어 검색
// ============================================================

/** 페르소나 텍스트 컬럼 (백엔드 PERSONA_TEXT_COLS와 1:1 대응). */
export const PERSONA_TEXT_COLUMNS = [
  "persona",
  "professional_persona",
  "sports_persona",
  "arts_persona",
  "travel_persona",
  "culinary_persona",
  "family_persona",
] as const;
export type PersonaTextColumn = (typeof PERSONA_TEXT_COLUMNS)[number];

export type PersonaSample = {
  uuid: string;
  text: string;
  length: number;
  sex: string;
  age: number;
  province: string;
  district: string;
  occupation: string;
};

export type PersonaSamplesResponse = {
  column: string;
  limit: number;
  samples: PersonaSample[];
};

export async function getPersonaSamples(
  column: PersonaTextColumn,
  limit = 8,
): Promise<PersonaSamplesResponse> {
  const res = await fetch(
    `${BASE_URL}/api/dataset/personas/samples?column=${column}&limit=${limit}`,
  );
  if (!res.ok) throw new Error(`샘플 조회 실패: HTTP ${res.status}`);
  return res.json();
}

export type PersonaSearchResult = {
  uuid: string;
  similarity: number;
  persona: string;
  sex: string;
  age: number;
  province: string;
  district: string;
  occupation: string;
  marital_status: string | null;
  family_type: string | null;
};

export type PersonaSearchResponse = {
  query: string;
  /** 전체 데이터 행 수 (분모) */
  total_candidates: number;
  /** LLM 메타 추출 + 명시 메타 조건만 적용한 후의 후보 수 ('부합하는 사람') */
  meta_filter_total: number;
  /** 최종 매칭 수 (메타 + 선택적 임베딩 컷 후) */
  match_total: number;
  /** 임베딩 임계값 컷이 적용된 경우만 (보통 자유어 검색 시 0.3) */
  match_threshold: number | null;
  /** LLM이 자연어에서 자동 추출한 메타 (UI 칩 노출용). 실패 시에도 빈 값으로 채워진 dict를 반환. */
  extracted_filter: ExtractedFilter | null;
  /** 표시된 상위 K건의 유사도 범위 */
  score_range: { max: number | null; min: number | null };
  elapsed_ms: { extract: number; embed: number; filter: number; search: number; total: number };
  results: PersonaSearchResult[];
};

export async function searchPersonas(
  query: string,
  limit = 20,
): Promise<PersonaSearchResponse> {
  const res = await fetch(`${BASE_URL}/api/dataset/personas/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = `${detail} — ${body.detail}`;
    } catch {
      // JSON 아닐 수 있음
    }
    throw new Error(`검색 실패: ${detail}`);
  }
  return res.json();
}

// ============================================================
// 파일 → 텍스트 추출 (TXT/PDF/DOCX)
// ============================================================

export type ExtractResponse = {
  filename: string;
  char_count: number;
  text: string;
  truncated: boolean;
};

export const SUPPORTED_EXTENSIONS = [".txt", ".pdf", ".docx", ".hwp", ".hwpx"];
export const MAX_FILE_SIZE_MB = 10;

// ============================================================
// 페르소나 탐색 (Survey Platform part1)
// ============================================================

export type PersonaCard = {
  uuid: string;
  sex: string;
  age: number;
  province: string;
  district: string;
  occupation: string;
  family_type: string | null;
  marital_status: string | null;
  education_level: string | null;
  persona: string;
  /** 자연어 쿼리가 있을 때만 (코사인 유사도 -1~1) */
  similarity: number | null;
};

export type PersonaFilterRequest = {
  age_min?: number | null;
  age_max?: number | null;
  /** "남자" | "여자" — 백엔드에서 enum 검증. string[]로 완화해 마법사 state와 호환 */
  sex?: string[];
  provinces?: string[];
  family_types?: string[];
  education_levels?: string[];
  occupations?: string[];
  query?: string | null;
  page?: number;
  page_size?: number;
};

export type PersonaFilterDistribution = {
  sex: Record<string, number>;
  age_bins: { label: string; count: number }[];
  province: Record<string, number>;
};

export type ExtractedFilter = {
  sex: string[];
  age_min: number | null;
  age_max: number | null;
  provinces: string[];
  marital_statuses: string[];
  has_children: boolean | null;
  /** "employed" → 직장인(무직 제외) / "unemployed" → 무직 / null → 미지정 */
  employment_status: "employed" | "unemployed" | null;
  occupations: string[];
  education_levels: string[];
  /** has_children=true/false에 따라 자동 매핑된 family_type 목록 */
  family_types: string[];
  /** 명시 필드 외 컬럼 자동 추출 (housing_type/bachelors_field/military_status/district 등) */
  additional_filters: Record<string, string[]>;
  remaining_query: string;
};

/** additional_filters 컬럼 → 한국어 라벨 (UI 칩 표시용) */
export const ADDITIONAL_FILTER_LABELS: Record<string, string> = {
  housing_type: "주거 형태",
  bachelors_field: "전공 계열",
  military_status: "병역",
  district: "시군구",
};

export type PersonaFilterResponse = {
  /** 최종 매칭 수 */
  total: number;
  /** 메타 필터(명시 + 자동 추출)만 적용한 후의 수 */
  meta_filter_total: number;
  /** 자동 추출 메타가 비어 fallback 컷이 적용된 경우만 (보통은 null) */
  match_threshold: number | null;
  /** 자연어 쿼리에서 LLM이 자동 추출한 메타 (UI 칩 노출용) */
  extracted_filter: ExtractedFilter | null;
  page: number;
  page_size: number;
  page_personas: PersonaCard[];
  distribution: PersonaFilterDistribution;
  has_query: boolean;
  elapsed_ms: { extract?: number; filter: number; search: number; total: number };
};

export type PersonaFacets = {
  provinces: string[];
  sex: string[];
  family_types: string[];
  education_levels: string[];
  marital_statuses: string[];
  age_range: { min: number; max: number };
};

export type PersonaDetail = Record<string, string | number | null>;

export async function getPersonaFacets(): Promise<PersonaFacets> {
  const res = await fetch(`${BASE_URL}/api/dataset/personas/facets`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function filterPersonas(
  req: PersonaFilterRequest,
): Promise<PersonaFilterResponse> {
  const res = await fetch(`${BASE_URL}/api/dataset/personas/filter`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = `${detail} — ${body.detail}`;
    } catch {
      /* not json */
    }
    throw new Error(`필터 실패: ${detail}`);
  }
  return res.json();
}

export async function getPersonaDetail(uuid: string): Promise<PersonaDetail> {
  const res = await fetch(
    `${BASE_URL}/api/dataset/personas/${encodeURIComponent(uuid)}`,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ============================================================
// 설문 시뮬레이션 플랫폼 — Survey · Segment (Survey Platform part2)
// ============================================================

export type QuestionType =
  | "single_choice"
  | "multi_choice"
  | "scale"
  | "open_ended"
  | "nps";

export type SurveyStatus = "draft" | "running" | "completed" | "failed";

export type SamplingMode = "all" | "random_n" | "proportional";

// LLMProvider는 위쪽(L104)에서 이미 정의됨 — 재사용

export type SurveyQuestion = {
  id: string;
  order: number;
  type: QuestionType;
  text: string;
  options: string[];
  scale_min: number | null;
  scale_max: number | null;
  scale_label_low: string | null;
  scale_label_high: string | null;
  required: boolean;
};

export type TargetFilter = {
  age_min: number | null;
  age_max: number | null;
  sex: string[];
  provinces: string[];
  family_types: string[];
  education_levels: string[];
  occupations: string[];
  query: string | null;
  sampling: SamplingMode;
  sample_size: number;
};

export type ExecutionConfig = {
  llm_provider: LLMProvider;
  model: string;
  temperature: number;
  include_reasoning: boolean;
};

export type Survey = {
  id: string;
  title: string;
  description: string;
  objective: string;
  status: SurveyStatus;
  target_filter: TargetFilter;
  execution: ExecutionConfig;
  questions: SurveyQuestion[];
  persona_uuids: string[];
  created_at: string;
  updated_at: string;
};

export type SurveySummary = {
  id: string;
  title: string;
  status: SurveyStatus;
  objective: string;
  question_count: number;
  persona_count: number;
  created_at: string;
  updated_at: string;
};

export type SurveyListResponse = {
  items: SurveySummary[];
  total: number;
  limit: number;
  offset: number;
};

export type SurveyCreateRequest = {
  title: string;
  description?: string;
  objective?: string;
  target_filter: TargetFilter;
  execution: ExecutionConfig;
  questions: SurveyQuestion[];
  persona_uuids?: string[];
};

export type Segment = {
  id: string;
  name: string;
  description: string;
  filter: TargetFilter;
  persona_uuids: string[];
  size: number;
  created_at: string;
};

export type SegmentSummary = {
  id: string;
  name: string;
  description: string;
  size: number;
  created_at: string;
};

export type SegmentListResponse = {
  items: SegmentSummary[];
  total: number;
  limit: number;
  offset: number;
};

export type SegmentCreateRequest = {
  name: string;
  description?: string;
  filter: TargetFilter;
  persona_uuids: string[];
};

async function _jsonRequest<T>(
  url: string,
  init: RequestInit,
  errorLabel: string,
): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = `${detail} — ${body.detail}`;
    } catch {
      /* not json */
    }
    throw new Error(`${errorLabel}: ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// --- Survey ---

export function createSurvey(req: SurveyCreateRequest): Promise<Survey> {
  return _jsonRequest<Survey>(
    `${BASE_URL}/api/surveys`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    },
    "설문 생성 실패",
  );
}

export function listSurveys(
  status?: SurveyStatus,
  limit = 50,
  offset = 0,
): Promise<SurveyListResponse> {
  const q = new URLSearchParams();
  if (status) q.set("status", status);
  q.set("limit", String(limit));
  q.set("offset", String(offset));
  return _jsonRequest<SurveyListResponse>(
    `${BASE_URL}/api/surveys?${q.toString()}`,
    { method: "GET" },
    "설문 목록 조회 실패",
  );
}

export function getSurvey(id: string): Promise<Survey> {
  return _jsonRequest<Survey>(
    `${BASE_URL}/api/surveys/${encodeURIComponent(id)}`,
    { method: "GET" },
    "설문 조회 실패",
  );
}

export function updateSurvey(id: string, req: SurveyCreateRequest): Promise<Survey> {
  return _jsonRequest<Survey>(
    `${BASE_URL}/api/surveys/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    },
    "설문 갱신 실패",
  );
}

export function deleteSurvey(id: string): Promise<void> {
  return _jsonRequest<void>(
    `${BASE_URL}/api/surveys/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    "설문 삭제 실패",
  );
}

// --- AI 질문 추천 ---

export type SuggestQuestionsRequest = {
  title?: string;
  description?: string;
  objective?: string;
  target_filter?: TargetFilter | null;
  num?: number;
  existing_question_texts?: string[];
  start_order?: number;
};

export type SuggestQuestionsResponse = {
  questions: SurveyQuestion[];
};

export function suggestQuestions(
  req: SuggestQuestionsRequest,
): Promise<SuggestQuestionsResponse> {
  return _jsonRequest<SuggestQuestionsResponse>(
    `${BASE_URL}/api/surveys/suggest-questions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    },
    "AI 추천 실패",
  );
}

// --- 질문 파일 업로드 파싱 (xlsx/csv/docx) ---

export type ParsedQuestion = {
  row: number;
  type: QuestionType;
  text: string;
  options: string[];
  scale_min: number | null;
  scale_max: number | null;
  required: boolean;
  errors: string[];
};

export type ParseResult = {
  filename: string;
  file_format: "xlsx" | "csv" | "docx";
  summary: { total: number; valid: number; invalid: number };
  questions: ParsedQuestion[];
};

export async function parseQuestionsFile(file: File): Promise<ParseResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE_URL}/api/surveys/questions/parse-file`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = `${detail} — ${body.detail}`;
    } catch {
      /* not json */
    }
    throw new Error(`파일 파싱 실패: ${detail}`);
  }
  return res.json();
}

export function getQuestionTemplateUrl(format: "excel" | "word"): string {
  return `${BASE_URL}/api/surveys/questions/template/${format}`;
}

export const QUESTION_UPLOAD_EXTS = [".xlsx", ".xls", ".csv", ".docx"];
export const QUESTION_UPLOAD_MAX_MB = 5;

// --- Segment ---

export function createSegment(req: SegmentCreateRequest): Promise<Segment> {
  return _jsonRequest<Segment>(
    `${BASE_URL}/api/segments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    },
    "세그먼트 저장 실패",
  );
}

export function listSegments(limit = 100, offset = 0): Promise<SegmentListResponse> {
  const q = new URLSearchParams();
  q.set("limit", String(limit));
  q.set("offset", String(offset));
  return _jsonRequest<SegmentListResponse>(
    `${BASE_URL}/api/segments?${q.toString()}`,
    { method: "GET" },
    "세그먼트 목록 조회 실패",
  );
}

export function getSegment(id: string): Promise<Segment> {
  return _jsonRequest<Segment>(
    `${BASE_URL}/api/segments/${encodeURIComponent(id)}`,
    { method: "GET" },
    "세그먼트 조회 실패",
  );
}

export function deleteSegment(id: string): Promise<void> {
  return _jsonRequest<void>(
    `${BASE_URL}/api/segments/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    "세그먼트 삭제 실패",
  );
}

// ============================================================
// 설문 진행률 & 재시도 (Survey Platform part5)
// ============================================================

export type FailedPersonaInfo = {
  persona_uuid: string;
  error: string | null;
  started_at: string | null;
};

export type SessionCounts = {
  pending: number;
  running: number;
  completed: number;
  failed: number;
};

export type SurveyStatusResponse = {
  survey_id: string;
  survey_status: SurveyStatus;
  total: number;
  counts: SessionCounts;
  completed_ratio: number;       // 0.0 ~ 1.0 (페르소나 단위)
  answered_questions: number;    // 답한 문항 누적 (부분 진행 포함)
  total_planned_answers: number; // total × question_count
  answered_ratio: number;        // 0.0 ~ 1.0 (문항 단위, 즉각 반영)
  avg_response_seconds: number | null;
  total_tokens: number;
  failed_personas: FailedPersonaInfo[];
};

export type RetryResponse = {
  status: "started" | "noop";
  survey_id: string;
  retry_count: number;
};

export function getSurveyStatus(id: string): Promise<SurveyStatusResponse> {
  return _jsonRequest<SurveyStatusResponse>(
    `${BASE_URL}/api/surveys/${encodeURIComponent(id)}/status`,
    { method: "GET" },
    "진행률 조회 실패",
  );
}

export function retryFailedSessions(id: string): Promise<RetryResponse> {
  return _jsonRequest<RetryResponse>(
    `${BASE_URL}/api/surveys/${encodeURIComponent(id)}/retry-failed`,
    { method: "POST" },
    "재시도 실패",
  );
}

export type RunTriggerResponse = {
  status: "started";
  survey_id: string;
  total: number;
  questions: number;
  reset: number;
  completed_preserved: number;
  started_at: string;
};

export function triggerSurveyRun(
  id: string,
  options: { force?: boolean } = {},
): Promise<RunTriggerResponse> {
  const qs = options.force ? "?force=true" : "";
  return _jsonRequest<RunTriggerResponse>(
    `${BASE_URL}/api/surveys/${encodeURIComponent(id)}/run${qs}`,
    { method: "POST" },
    "시뮬레이션 시작 실패",
  );
}

// ============================================================
// 응답 조회 & 차트 리포트 (Survey Platform part6-7)
// ============================================================

export type SurveyAnswer = {
  question_id: string;
  answer_value: string | number | string[];
  reasoning: string;
  confidence: number;
};

export type SurveyResponseSession = {
  id: string;
  survey_id: string;
  persona_uuid: string;
  status: "pending" | "running" | "completed" | "failed";
  started_at: string | null;
  completed_at: string | null;
  llm_model_used: string;
  total_tokens: number;
  error: string | null;
  answers: SurveyAnswer[];
};

export type PersonaWithSession = {
  persona_uuid: string;
  sex: string;
  age: number;
  province: string;
  district: string;
  occupation: string;
  family_type: string | null;
  marital_status: string | null;
  persona: string;
  session: SurveyResponseSession;
};

export type ResponsesResponse = {
  survey_id: string;
  total_personas: number;
  completed: number;
  failed: number;
  page: number;
  page_size: number;
  items: PersonaWithSession[];
};

export function getSurveyResponses(
  id: string,
  opts: {
    page?: number;
    page_size?: number;
    q?: string;
    status_filter?: "completed" | "failed" | "pending" | "running";
  } = {},
): Promise<ResponsesResponse> {
  const sp = new URLSearchParams();
  if (opts.page) sp.set("page", String(opts.page));
  if (opts.page_size) sp.set("page_size", String(opts.page_size));
  if (opts.q) sp.set("q", opts.q);
  if (opts.status_filter) sp.set("status_filter", opts.status_filter);
  return _jsonRequest<ResponsesResponse>(
    `${BASE_URL}/api/surveys/${encodeURIComponent(id)}/responses?${sp.toString()}`,
    { method: "GET" },
    "응답 조회 실패",
  );
}

// --- 리포트 ---

export type OpenEndedSample = {
  persona_uuid: string;
  sex: string;
  age: number;
  province: string;
  occupation: string;
  answer: string;
  reasoning: string;
  confidence: number;
};

export type QuestionReport = {
  question_id: string;
  order: number;
  type: QuestionType;
  text: string;
  total_responses: number;
  avg_confidence: number;
  choice_distribution: Record<string, number> | null;
  scale_histogram: { score: number; count: number; label: string | null }[] | null;
  scale_mean: number | null;
  scale_median: number | null;
  open_ended_samples: OpenEndedSample[] | null;
  open_ended_length_avg: number | null;
  open_ended_length_max: number | null;
};

export type RespondentDistribution = {
  sex: Record<string, number>;
  age_bins: { label: string; count: number }[];
  province: Record<string, number>;
};

export type ReportSummary = {
  total_completed: number;
  total_failed: number;
  total_tokens: number;
  avg_response_seconds: number | null;
};

export type ReportResponse = {
  survey: Survey;
  summary: ReportSummary;
  respondent_distribution: RespondentDistribution;
  questions: QuestionReport[];
  overall_commentary: string | null;
};

export function getSurveyReport(id: string): Promise<ReportResponse> {
  return _jsonRequest<ReportResponse>(
    `${BASE_URL}/api/surveys/${encodeURIComponent(id)}/report`,
    { method: "GET" },
    "리포트 조회 실패",
  );
}

export function getSurveyReportCsvUrl(id: string): string {
  return `${BASE_URL}/api/surveys/${encodeURIComponent(id)}/report.csv`;
}

// ============================================================
// A/B 테스트 — 두 안 비교 분석
// ============================================================

export type ABTestInputMode = "terms" | "marketing" | "concept";

/** 도전안(기준이 아닌 쪽)의 성격. internal=당사 다른 상품, external=타사 상품. */
export type ABChallengerKind = "internal" | "external";

export type ABTestVariantInput = {
  label: string;
  text: string;
};

export type ABTestRequest = {
  company_context: string;
  input_mode: ABTestInputMode;
  variant_a: ABTestVariantInput;
  variant_b: ABTestVariantInput;
  /** 당사 안(기준)으로 지정할 쪽. 다른 쪽은 비교 검토 대상. */
  baseline_variant: "A" | "B";
  /** 도전안의 성격 (internal=당사 다른 상품 / external=타사 상품). */
  challenger_kind: ABChallengerKind;
  llm_provider: LLMProvider;
  top_k?: number;
};

export type ABVariantResult = {
  label: string;
  selling_points: SellingPoints;
  top_personas: PersonaHit[];
  province_stats: RegionStat[];
  population_stats: PopulationStats;
  top_opinions: PersonaOpinion[];
};

export type ComparisonRow = {
  key: string;
  label: string;
  a_value: string;
  b_value: string;
  delta: string;
  winner: "A" | "B" | "tie";
};

export type ABComparison = {
  summary_table: ComparisonRow[];
  category_diff: Record<string, { a: number; b: number; delta: number }>;
};

export type ABTestResponse = {
  abtest_id: string;
  input_mode: ABTestInputMode;
  company_context: string;
  baseline_variant: "A" | "B";
  challenger_kind: ABChallengerKind;
  variant_a: ABVariantResult;
  variant_b: ABVariantResult;
  comparison: ABComparison;
  company_insights_md: string;
  fp_strategy_md: string;
  recommended_variant: "A" | "B" | "split";
  elapsed_ms: Record<string, number>;
};

export type ABTestSummary = {
  id: string;
  created_at: string;
  input_mode: ABTestInputMode;
  baseline_variant: "A" | "B";
  challenger_kind: ABChallengerKind;
  label_a: string;
  label_b: string;
  baseline_label: string;
  challenger_label: string;
  recommended_variant: "A" | "B" | "split";
  recommended_label: string;
  total_ms: number;
  llm_provider: LLMProvider;
};

export type ABTestsListResponse = {
  total: number;
  items: ABTestSummary[];
};

export async function listABTests(
  limit = 50,
  offset = 0,
): Promise<ABTestsListResponse> {
  const res = await fetch(
    `${BASE_URL}/api/abtests?limit=${limit}&offset=${offset}`,
  );
  if (!res.ok) throw new Error(`A/B 이력 조회 실패: HTTP ${res.status}`);
  return res.json();
}

export async function getABTest(id: string): Promise<ABTestResponse> {
  const res = await fetch(`${BASE_URL}/api/abtests/${encodeURIComponent(id)}`);
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = `${detail} — ${body.detail}`;
    } catch {
      // not json
    }
    throw new Error(`A/B 상세 조회 실패: ${detail}`);
  }
  return res.json();
}

export async function deleteABTest(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/abtests/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = `${detail} — ${body.detail}`;
    } catch {
      // not json
    }
    throw new Error(`A/B 이력 삭제 실패: ${detail}`);
  }
}

export async function runABTest(req: ABTestRequest): Promise<ABTestResponse> {
  const res = await fetch(`${BASE_URL}/api/abtest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = `${detail} — ${body.detail}`;
    } catch {
      // JSON 아닐 수 있음
    }
    throw new Error(`A/B 분석 실패: ${detail}`);
  }
  return res.json();
}

export async function extractTextFromFile(file: File): Promise<ExtractResponse> {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${BASE_URL}/api/extract-text`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      // 응답 본문이 JSON이 아닐 수 있음.
    }
    throw new Error(detail);
  }

  return res.json();
}
