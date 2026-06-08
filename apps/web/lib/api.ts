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
  /**
   * 모집단 100만 명 내에서의 이 페르소나의 백분위 (0~100, 100=최상위).
   * raw score(0~100)와 함께 카드에 보조 라벨로 노출 — 'score 78점 + 상위 0.1%'.
   * 옛 분석 이력에는 없음(null).
   */
  percentile_score?: number | null;
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
  /**
   * per-capita(농도) — 옵셔널, 옛 이력엔 없음. 해당 지역 전체 모집단 인원(분모).
   */
  population_count?: number | null;
  /**
   * 지역 타겟 농도 / 전국 평균 농도. 1.0=전국 평균, >1=인구 대비 과집중(숨은 핫스팟).
   * 인원(count) 1위는 늘 대도시라 뻔하지만 lift는 의외의 소도시를 드러낸다.
   */
  lift_ratio?: number | null;
};

export type CohortStat = {
  name: string;          // "core" | "target" | "interest"
  label: string;         // 표시용
  percentile: number;    // 폴백 percentile 임계값 (mode=percentile일 때만 실제 적용)
  size: number;
  min_score: number;
  avg_score: number;
  /**
   * 컷 방식. absolute=절대 점수 컷 적용, percentile=인원 부족으로 폴백.
   * 옛 분석 이력에는 없을 수 있어 옵셔널.
   */
  mode?: "absolute" | "percentile";
  /**
   * 절대 점수 임계값 (참조용). 새 분석은 항상 채워지지만 옛 이력에는 없을 수 있어 옵셔널.
   */
  threshold_absolute?: number;
};

export type DistributionBin = {
  label: string;
  count: number;
  /**
   * baseline-lift (옵셔널, 옛 이력엔 없음). 타겟 cohort 분포를 '전체 100만 모집단'
   * 분포와 비교한 메타. 절대 비율(흔한 통계)을 '전국 대비 N배'(발견 인사이트)로 격상.
   */
  share?: number | null;          // 타겟 내 비율 (count/target_total)
  baseline_share?: number | null; // 전체 모집단 내 비율
  /** share / baseline_share. 1.0=전국 동일, >1=과대표집, <1=과소표집. */
  lift_ratio?: number | null;
};

export type DemographicGroup = {
  column: string;        // 원본 컬럼명 (sex, marital_status, ...)
  label: string;         // 표시용 라벨
  bins: DistributionBin[];
  total_unique: number;
  truncated_to: number | null;
};

export type ScoreDriver = {
  /** cosine | rule | category | insurance */
  key: string;
  label: string;
  /** core cohort 평균에서 이 항의 점수 기여(절대) */
  core_contribution: number;
  /** 전체 모집단 평균에서 이 항의 점수 기여(절대) */
  pop_contribution: number;
  /** core_contribution - pop_contribution. core를 모집단 위로 끌어올린 정도 */
  delta: number;
};

export type ConfidenceStats = {
  core_mean: number;
  core_ci_low: number;
  core_ci_high: number;
  target_mean: number;
  target_ci_low: number;
  target_ci_high: number;
  core_cut: number;
  core_size: number;
  /** 컷 -1점 시 core 인원(증가분 관찰) */
  core_size_relaxed: number;
  /** 컷 +1점 시 core 인원(감소분 관찰) */
  core_size_tightened: number;
};

export type SegmentFinding = {
  dimensions: Record<string, string>;
  label: string;
  target_count: number;
  population_count: number;
  share: number;
  baseline_share: number;
  /** share/baseline_share — 전국 대비 집중 배수(>1=과집중) */
  lift_ratio: number;
  avg_score: number;
};

export type PopulationStats = {
  total_scored: number;
  cohorts: CohortStat[];
  score_distribution: DistributionBin[];
  demographics: DemographicGroup[];
  /** 타겟 cohort 기준 전국 시군구 집계 (지도/Top10 표용). name 형식: "시도-시군구". */
  districts_full: RegionStat[];
  /**
   * raw 분포 통계 (PR-1 신설). 모두 옵셔널 — 옛 분석 이력에는 없음.
   * 분포가 [52,78]로 좁아 cohort 인원만으로 안 간 차이가 안 보이는 문제 보완.
   */
  raw_mean?: number | null;
  raw_std?: number | null;
  raw_p50?: number | null;
  raw_p95?: number | null;
  raw_p99?: number | null;
  raw_max?: number | null;
  n_above_80?: number | null;
  n_above_65?: number | null;
  core_lift?: number | null;
  target_lift?: number | null;
  quality_flags?: string[];
  /** 점수 산출 체계. "v2_hybrid"=z-score+제품오프셋. 옛 분석은 undefined → 구(균등매핑). */
  scoring_version?: string;
  /** Score DNA — core 점수가 의미/인구통계/관심사/보험관심 중 무엇에서 떴는지 항 분해. 옛 이력은 빈 배열/undefined. */
  score_drivers?: ScoreDriver[];
  /** cohort 평균 95% 신뢰구간 + 컷 민감도. 옛 이력은 null/undefined. */
  confidence?: ConfidenceStats | null;
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
  /** 전체 점수 median 근처 N명 — 평균 시장 반응. 옛 이력은 빈 배열. */
  mid_personas?: PersonaHit[];
  bottom_personas: PersonaHit[];
  province_stats: RegionStat[];
  district_stats: RegionStat[];
  population_stats: PopulationStats;
  top_opinions: PersonaOpinion[];
  /** mid_personas와 같은 순서 매칭. 옛 이력은 빈 배열. */
  mid_opinions?: PersonaOpinion[];
  bottom_opinions: PersonaOpinion[];
  report_md: string;
  /** 타겟 cohort 교차 세그먼트 발굴(lift 순). LLM 0콜. 옛 이력은 빈 배열. */
  segments?: SegmentFinding[];
  elapsed_ms: Record<string, number>;
};

// 빈 문자열 = 동일 오리진 (Next.js rewrites가 /api/* → FastAPI 5102로 프록시).
// 외부 호스트에서 직접 FastAPI를 호출해야 할 때만 NEXT_PUBLIC_API_BASE_URL 설정.
const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

// ============================================================
// LLM provider 선택 (analyze · simulate 양쪽에서 공유)
// ============================================================

export type LLMProvider = "anthropic" | "sllm" | "openai";

export function analyzeProduct(
  productText: string,
  topK = 20,
  llmProvider: LLMProvider = "sllm",
): Promise<AnalyzeResponse> {
  return _jsonRequest<AnalyzeResponse>(
    `${BASE_URL}/api/analyze`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product_text: productText,
        top_k: topK,
        llm_provider: llmProvider,
      }),
    },
    "분석 실패",
  );
}

// ============================================================
// 분석 SSE 스트리밍 — 단계별(소구점→스코어→의견→리포트) 부분 결과 흘려보내기
// ============================================================

/** /api/analyze/stream 의 SSE 프레임 — event별 data 구조. */
export type AnalyzeStreamEvent =
  | { event: "selling_points"; data: { selling_points: SellingPoints; elapsed_ms: Record<string, number> } }
  | {
      event: "score";
      data: {
        top_personas: PersonaHit[];
        mid_personas: PersonaHit[];
        bottom_personas: PersonaHit[];
        province_stats: RegionStat[];
        district_stats: RegionStat[];
        population_stats: PopulationStats;
        segments: SegmentFinding[];
        elapsed_ms: Record<string, number>;
      };
    }
  | {
      event: "opinions";
      data: {
        top_opinions: PersonaOpinion[];
        mid_opinions: PersonaOpinion[];
        bottom_opinions: PersonaOpinion[];
        elapsed_ms: Record<string, number>;
      };
    }
  | { event: "report_token"; data: { chunk: string } }
  | { event: "report"; data: { report_md: string; elapsed_ms: Record<string, number> } }
  | { event: "done"; data: { analysis_id: string; elapsed_ms: Record<string, number> } }
  | { event: "error"; data: { status?: number; detail: string } };

function _parseSseFrame(frame: string): AnalyzeStreamEvent | null {
  let event = "message";
  let dataStr = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
  }
  if (!dataStr) return null;
  try {
    return { event, data: JSON.parse(dataStr) } as AnalyzeStreamEvent;
  } catch {
    return null;
  }
}

/**
 * 분석을 SSE로 스트리밍. 각 단계 프레임을 onEvent로 전달한다.
 * 서버가 보낸 error 이벤트도 onEvent로 전달되며 스트림은 정상 종료된다(throw 아님).
 * 네트워크/파싱 실패나 스트리밍 미지원 시에만 reject → 호출부가 블로킹 analyzeProduct로 폴백.
 */
export async function analyzeProductStream(
  productText: string,
  topK: number,
  llmProvider: LLMProvider,
  onEvent: (e: AnalyzeStreamEvent) => void,
): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/analyze/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product_text: productText, top_k: topK, llm_provider: llmProvider }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`스트리밍 분석 실패: HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const ev = _parseSseFrame(frame);
      if (ev) onEvent(ev);
    }
  }
}

// ============================================================
// What-if 실험실 — 기 분석 위에서 타겟·가중치만 바꿔 즉시 재점수
// ============================================================

export type WhatIfRequest = {
  analysis_id: string;
  /** None(미전송)=원본 유지. [] (배열)=명시적 해제. */
  target_age_min?: number | null;
  target_age_max?: number | null;
  target_sex?: string[] | null;
  target_family_types?: string[] | null;
  target_education_levels?: string[] | null;
  target_occupations?: string[] | null;
  persona_category_weights?: Record<string, number> | null;
};

export type WhatIfResponse = {
  population_stats: PopulationStats;
  segments?: SegmentFinding[];
  top_personas: PersonaHit[];
  elapsed_ms: Record<string, number>;
};

/** 임베딩 0콜(캐시 hit) 즉답 재점수 — 슬라이더 디바운스 호출용. */
export function runWhatIf(req: WhatIfRequest): Promise<WhatIfResponse> {
  return _jsonRequest<WhatIfResponse>(
    `${BASE_URL}/api/whatif`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    },
    "What-if 재점수 실패",
  );
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

export function listAnalyses(
  limit = 50,
  offset = 0,
): Promise<AnalysesListResponse> {
  return _jsonRequest<AnalysesListResponse>(
    `${BASE_URL}/api/analyses?limit=${limit}&offset=${offset}`,
    { method: "GET" },
    "이력 조회 실패",
  );
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

export function getAnalysis(id: string): Promise<AnalysisDetail> {
  return _jsonRequest<AnalysisDetail>(
    `${BASE_URL}/api/analyses/${id}`,
    { method: "GET" },
    "이력 상세 실패",
  );
}

/** 단건 삭제 — 연관 시뮬레이션도 함께 정리됨. */
export function deleteAnalysis(id: string): Promise<void> {
  return _jsonRequest<void>(
    `${BASE_URL}/api/analyses/${id}`,
    { method: "DELETE" },
    "이력 삭제 실패",
  );
}

/** 전체 삭제 — 분석·시뮬레이션 모두 비움. 되돌릴 수 없음. */
export function deleteAllAnalyses(): Promise<{
  analyses: number;
  simulations: number;
}> {
  return _jsonRequest<{ analyses: number; simulations: number }>(
    `${BASE_URL}/api/analyses`,
    { method: "DELETE" },
    "전체 삭제 실패",
  );
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

export function simulateSurvey(
  analysisId: string,
  question: string,
  nRespondents: number,
  llmProvider: LLMProvider = "sllm",
): Promise<SimulateResponse> {
  return _jsonRequest<SimulateResponse>(
    `${BASE_URL}/api/simulate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        analysis_id: analysisId,
        question,
        n_respondents: nRespondents,
        llm_provider: llmProvider,
      }),
    },
    "시뮬레이션 실패",
  );
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

export function getDatasetOverview(): Promise<DatasetOverview> {
  return _jsonRequest<DatasetOverview>(
    `${BASE_URL}/api/dataset/overview`,
    { method: "GET" },
    "현황 조회 실패",
  );
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

export function getPersonaSamples(
  column: PersonaTextColumn,
  limit = 8,
): Promise<PersonaSamplesResponse> {
  return _jsonRequest<PersonaSamplesResponse>(
    `${BASE_URL}/api/dataset/personas/samples?column=${column}&limit=${limit}`,
    { method: "GET" },
    "샘플 조회 실패",
  );
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

export function searchPersonas(
  query: string,
  limit = 20,
): Promise<PersonaSearchResponse> {
  return _jsonRequest<PersonaSearchResponse>(
    `${BASE_URL}/api/dataset/personas/search`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit }),
    },
    "검색 실패",
  );
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
  /** 금융 속성 필터 (AI Hub 통신카드CB 통합) */
  insurance_interest?: boolean;
  life_stages?: string[];
  income_top?: boolean;
  query?: string | null;
  page?: number;
  page_size?: number;
};

export type PersonaFilterDistribution = {
  sex: Record<string, number>;
  age_bins: { label: string; count: number }[];
  province: Record<string, number>;
  // 현황(overview)과 동일 구조 — 매칭 결과 전체 기준 직업군·가구·주거 분포.
  occupations_grouped: OccupationGroup[];
  family_type: DistributionBin[];
  housing_type: DistributionBin[];
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
  /**
   * LLM 메타 추출이 너무 좁아 매칭 0명이 나왔을 때 백엔드가 자동으로
   * 한 단계(좁은 라벨 제거+키워드 임베딩) 또는 두 단계(메타 전체 해제+원문 임베딩)
   * 폴백 검색을 수행했는지 여부.
   */
  fallback_applied: boolean;
  /** 폴백이 적용된 경우 어떤 폴백이 적용됐는지 사용자에게 보여줄 안내 문구. */
  fallback_reason: string | null;
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

export function getPersonaFacets(): Promise<PersonaFacets> {
  return _jsonRequest<PersonaFacets>(
    `${BASE_URL}/api/dataset/personas/facets`,
    { method: "GET" },
    "페르소나 옵션 조회 실패",
  );
}

export function filterPersonas(
  req: PersonaFilterRequest,
): Promise<PersonaFilterResponse> {
  return _jsonRequest<PersonaFilterResponse>(
    `${BASE_URL}/api/dataset/personas/filter`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    },
    "필터 실패",
  );
}

export function getPersonaDetail(uuid: string): Promise<PersonaDetail> {
  return _jsonRequest<PersonaDetail>(
    `${BASE_URL}/api/dataset/personas/${encodeURIComponent(uuid)}`,
    { method: "GET" },
    "페르소나 상세 조회 실패",
  );
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

// 현재 sLLM 게이트웨이가 호스팅 중인 실제 모델명 (백엔드 SSOT).
// 생성 폼이 모델명을 하드코딩하지 않고 이 값을 사용 — 서버 모델 교체에 자동 적응.
export function getSllmModel(): Promise<{ model: string }> {
  return _jsonRequest<{ model: string }>(
    `${BASE_URL}/api/surveys/sllm-model`,
    { method: "GET" },
    "sLLM 모델명 조회 실패",
  );
}

// 관리자 LLM 설정은 app/admin-9f4a2c/cfg route handler가 서버사이드에서 ADMIN_TOKEN을
// 주입해 처리한다(클라이언트 토큰 노출 방지). 관리자 페이지가 해당 경로를 직접 호출.

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

// --- 설문 placeholder 예시 (작성 폼 입력칸 힌트, 매 호출 다른 분야) ---

export type SurveyPlaceholders = {
  title: string;
  description: string;
  objective: string;
};

export function fetchSurveyPlaceholders(): Promise<SurveyPlaceholders> {
  return _jsonRequest<SurveyPlaceholders>(
    `${BASE_URL}/api/surveys/placeholder-examples`,
    // 매 호출 다른 예시를 받아야 하므로 브라우저 GET 캐시를 끈다.
    { method: "GET", cache: "no-store" },
    "예시 생성 실패",
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

export function parseQuestionsFile(file: File): Promise<ParseResult> {
  const form = new FormData();
  form.append("file", file);
  // FormData는 Content-Type(boundary)을 브라우저가 자동 설정하므로 헤더를 지정하지 않는다.
  return _jsonRequest<ParseResult>(
    `${BASE_URL}/api/surveys/questions/parse-file`,
    { method: "POST", body: form },
    "파일 파싱 실패",
  );
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

// 실시간 응답 라이브 피드 — '방금 답한 페르소나'가 흘러 들어오는 ticker용.
// PII 비노출(성별/나이/지역 + 답변만). status와 분리한 별도 경량 엔드포인트.
export type RecentAnswer = {
  persona_summary: string; // "여 34 · 서울 강남구"
  question_text: string;
  answer_text: string;
  reasoning: string;
  completed_at: string | null;
};

export type RecentAnswersResponse = {
  items: RecentAnswer[];
  completed_total: number;
};

export function getRecentAnswers(
  id: string,
  limit = 8,
): Promise<RecentAnswersResponse> {
  return _jsonRequest<RecentAnswersResponse>(
    `${BASE_URL}/api/surveys/${encodeURIComponent(id)}/recent-answers?limit=${limit}`,
    { method: "GET" },
    "실시간 응답 조회 실패",
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
  /** @deprecated Anthropic 호출 비활성. 옵셔널 — 미전송 시 backend default(sllm) 적용. */
  llm_provider?: LLMProvider;
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

export type ABOverlap = {
  /** A 반응자 중 B에도 반응한 비율(0~1, 비대칭) */
  a_to_b: number;
  /** B 반응자 중 A에도 반응한 비율(0~1, 비대칭) */
  b_to_a: number;
  /** 두 안 반응자 합집합 대비 교집합(0~1, 대칭) */
  jaccard: number;
  a_size: number;
  b_size: number;
  /** cannibal(잠식·같은 층) / complementary(보완·다른 층) / neutral(중간) */
  relation: "cannibal" | "complementary" | "neutral";
};

/** A/B 반응층 3분할(스윙=교집합 / A전용 / B전용) 1개 + 인구통계 프로파일. */
export type OverlapSegment = {
  key: "swing" | "a_only" | "b_only";
  label: string;
  size: number;
  demographics: DemographicGroup[];
};

/** 스윙층(양쪽 반응) 내부 안별 끌림 강도 — 줄다리기 맵. */
export type SwingPull = {
  swing_size: number;
  a_mean: number;
  b_mean: number;
  /** 스윙층 중 A 점수가 더 높은 비율(0~1). 0.5=완전 박빙 */
  a_lean_ratio: number;
  /** a_mean - b_mean. 양수=A로 기움 */
  mean_delta: number;
};

/** 분기 운영 처방 1행 — 한 인구통계 축에서 A/B 각각의 대표 세그먼트. */
export type SplitRule = {
  dimension: string;
  a_segment: string;
  a_count: number;
  b_segment: string;
  b_count: number;
};

export type ABComparison = {
  summary_table: ComparisonRow[];
  category_diff: Record<string, { a: number; b: number; delta: number }>;
  overlap?: ABOverlap | null;
  /**
   * 핵심 수치 지표 승부 집계 (평균점수·핵심/타겟 규모·가입의향·긍정비율).
   * 추천 확신도 스코어보드용. 구버전 이력은 undefined.
   */
  win_tally?: { a: number; b: number; tie: number } | null;
  /** 스윙/A전용/B전용 3층 인구통계 분해(스윙층 X-레이). 구버전은 null/undefined. */
  overlap_segments?: OverlapSegment[] | null;
  /** 스윙층 내부 안별 끌림 강도(줄다리기 맵). 구버전은 null. */
  swing_pull?: SwingPull | null;
  /** split 추천 시 'A로 팔 사람/B로 팔 사람' 분기 처방. 비-split이면 null. */
  split_playbook?: SplitRule[] | null;
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

export function listABTests(
  limit = 50,
  offset = 0,
): Promise<ABTestsListResponse> {
  return _jsonRequest<ABTestsListResponse>(
    `${BASE_URL}/api/abtests?limit=${limit}&offset=${offset}`,
    { method: "GET" },
    "A/B 이력 조회 실패",
  );
}

export function getABTest(id: string): Promise<ABTestResponse> {
  return _jsonRequest<ABTestResponse>(
    `${BASE_URL}/api/abtests/${encodeURIComponent(id)}`,
    { method: "GET" },
    "A/B 상세 조회 실패",
  );
}

export function deleteABTest(id: string): Promise<void> {
  return _jsonRequest<void>(
    `${BASE_URL}/api/abtests/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    "A/B 이력 삭제 실패",
  );
}

export function runABTest(req: ABTestRequest): Promise<ABTestResponse> {
  return _jsonRequest<ABTestResponse>(
    `${BASE_URL}/api/abtest`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    },
    "A/B 분석 실패",
  );
}

// ============================================================
// 잠식 행렬 (Cannibalization Matrix) — N개 안의 반응 코호트 겹침
// ============================================================

export type CannibalItemInput = { label: string; text: string };

export type CannibalCohortLevel = "core" | "target" | "interest";

export type CannibalRequest = {
  items: CannibalItemInput[];
  input_mode: ABTestInputMode;
  cohort_level: CannibalCohortLevel;
  llm_provider: LLMProvider;
};

export type CannibalItemMeta = {
  label: string;
  cohort_size: number;
  summary: string;
};

/** 포트폴리오 커버리지 — greedy union 라인업의 한 스텝. */
export type CoverageStep = {
  rank: number;
  item_index: number;
  label: string;
  /** 이 안 추가로 새로 닿는 인원(marginal lift) */
  marginal: number;
  /** 누적 도달(합집합) 인원 */
  cumulative: number;
};

/** 노출 다중도 — 각 페르소나가 몇 개 안의 반응층에 속하나. */
export type MultiplicityBin = {
  overlap_count: number;
  persona_count: number;
};

/** 전용층 — 오직 한 안에만 반응한 고유층 프로파일. */
export type ExclusiveProfile = {
  item_index: number;
  label: string;
  exclusive_size: number;
  /** 전용/전체코호트 비율 — 분모 아티팩트 보정용 */
  exclusive_ratio: number;
  demographics: DemographicGroup[];
  districts: RegionStat[];
};

export type CannibalResponse = {
  cannibal_id: string;
  items: CannibalItemMeta[];
  /** M[i][j] = |Ci∩Cj|/|Ci| — i안 반응자 중 j안에도 반응한 비율(비대칭). 대각선 1. */
  directional_matrix: number[][];
  /** J[i][j] = |Ci∩Cj|/|Ci∪Cj| — 대칭 겹침. 대각선 1. */
  jaccard_matrix: number[][];
  cohort_level: string;
  warnings: string[];
  elapsed_ms: Record<string, number>;
  coverage?: CoverageStep[] | null;
  multiplicity?: MultiplicityBin[] | null;
  exclusive_profiles?: ExclusiveProfile[] | null;
};

export function runCannibalization(
  req: CannibalRequest,
): Promise<CannibalResponse> {
  return _jsonRequest<CannibalResponse>(
    `${BASE_URL}/api/cannibal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    },
    "겹침 분석 실패",
  );
}

// --- 겹침 분석 이력 ---

export type CannibalSummary = {
  id: string;
  created_at: string;
  input_mode: ABTestInputMode;
  cohort_level: CannibalCohortLevel;
  item_count: number;
  labels: string[];
  total_ms: number;
  llm_provider: LLMProvider;
};

export type CannibalsListResponse = {
  total: number;
  items: CannibalSummary[];
};

export function listCannibals(
  limit = 50,
  offset = 0,
): Promise<CannibalsListResponse> {
  return _jsonRequest<CannibalsListResponse>(
    `${BASE_URL}/api/cannibals?limit=${limit}&offset=${offset}`,
    { method: "GET" },
    "겹침 분석 이력 조회 실패",
  );
}

export function getCannibal(id: string): Promise<CannibalResponse> {
  return _jsonRequest<CannibalResponse>(
    `${BASE_URL}/api/cannibals/${encodeURIComponent(id)}`,
    { method: "GET" },
    "겹침 분석 이력 상세 실패",
  );
}

export function deleteCannibal(id: string): Promise<void> {
  return _jsonRequest<void>(
    `${BASE_URL}/api/cannibals/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    "겹침 분석 이력 삭제 실패",
  );
}

// ============================================================
// 한화일반보험 상품 카탈로그
// ============================================================

export type ProductSummary = {
  id: string;
  name: string;
  official_name: string;
  category: string;
  page_url: string;
  body_available: boolean;
  body_chars: number | null;
};

export type ProductCatalog = {
  source: string;
  fetched_at: string;
  count: number;
  products: ProductSummary[];
};

export type ProductBody = {
  id: string;
  name: string;
  text: string;
  chars: number;
  source: "pdf" | "txt";
};

export async function listProducts(): Promise<ProductCatalog> {
  const res = await fetch(`${BASE_URL}/api/products`);
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }
  return res.json();
}

export async function getProductBody(productId: string): Promise<ProductBody> {
  const res = await fetch(
    `${BASE_URL}/api/products/${encodeURIComponent(productId)}/body`,
  );
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      // ignore
    }
    throw new Error(detail);
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
