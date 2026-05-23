"""PersonaFit API 요청·응답 스키마.

프론트엔드의 apps/web/lib/api.ts와 1:1 대응. 변경 시 양쪽 동기화 필수.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


# ============================================================
# 요청
# ============================================================

class AnalyzeRequest(BaseModel):
    """POST /api/analyze 요청 바디."""

    product_text: str = Field(
        ...,
        min_length=20,
        max_length=20_000,
        description="상품설명서 + 약관 본문 (20-20000자)",
    )
    top_k: int = Field(100, ge=5, le=100, description="반환할 상위 페르소나 수")
    llm_provider: Literal["anthropic", "sllm"] = Field(
        "sllm",
        description=(
            "사용할 LLM provider. anthropic=Claude Sonnet+Haiku, "
            "sllm=OpenAI 호환 vLLM (Qwen3.6-27B-FP8)"
        ),
    )


# ============================================================
# Claude 소구점 추출 결과
# ============================================================

class SellingPoints(BaseModel):
    """Claude(Sonnet)가 상품 텍스트에서 추출한 분석 결과.

    tool_use 모드로 스키마 강제. 누락 가능 필드는 None/빈 배열로.
    """

    summary: str = Field(..., description="상품을 한 줄로 요약")
    key_benefits: list[str] = Field(default_factory=list, description="핵심 혜택 3-5개")

    # 룰 기반 사전 필터링용
    target_age_min: int | None = Field(None, description="최소 가입 연령 (없으면 None)")
    target_age_max: int | None = Field(None, description="최대 가입 연령 (없으면 None)")
    target_sex: list[str] = Field(
        default_factory=list,
        description='["남자"] / ["여자"] / [] (성별 무관)',
    )
    target_family_types: list[str] = Field(
        default_factory=list,
        description="우대되는 가구 유형 (예: '배우자·자녀와 거주')",
    )
    target_education_levels: list[str] = Field(
        default_factory=list,
        description=(
            "필요·우대되는 교육 수준 (enum 7값): "
            "'무학', '초등학교', '중학교', '고등학교', "
            "'2~3년제 전문대학', '4년제 대학교', '대학원'"
        ),
    )
    target_occupations: list[str] = Field(
        default_factory=list,
        description=(
            "직업 키워드 (occupation 컬럼에 부분 매칭). "
            "예: ['의사', '교수', '간호사']. 약관에 직업 한정이 없으면 []"
        ),
    )

    # 임베딩 매칭용
    target_keywords: list[str] = Field(
        default_factory=list,
        description="페르소나 매칭에 쓸 5-10개 한국어 키워드",
    )

    # 카테고리 가중치 (합 1.0)
    persona_category_weights: dict[str, float] = Field(
        default_factory=lambda: {
            "professional": 0.0,
            "sports": 0.0,
            "arts": 0.0,
            "travel": 0.0,
            "culinary": 0.0,
            "family": 0.0,
        },
        description="6개 페르소나 카테고리 가중치 (합=1.0)",
    )


# ============================================================
# 검색 결과
# ============================================================

class PersonaHit(BaseModel):
    """매칭된 페르소나 1명 (상위/하위 모두 동일 스키마)."""

    uuid: str
    score: float = Field(..., description="0-100 정규화 반응도 점수")
    persona: str
    province: str
    district: str
    sex: str
    age: int
    occupation: str
    education_level: str | None = None
    family_type: str | None = None
    marital_status: str | None = None
    military_status: str | None = None


class PersonaOpinion(BaseModel):
    """페르소나가 상품에 대해 빙의 작성한 의견.

    설문(simulation)이 임의의 질문에 대한 응답이라면, opinion은
    상품 자체에 대한 자유 코멘트. 분석 시점에 top_k + bottom_k 모두 생성.
    """

    persona_uuid: str
    opinion_text: str = Field(..., description="1-2문장 본인 말투 의견")
    sentiment: Literal["긍정", "중립", "부정"]
    purchase_intent: int = Field(..., ge=1, le=5, description="가입 의향 1-5")
    key_concern: str | None = Field(
        None, description="본인이 가장 신경 쓰는 한 가지 (없으면 None)"
    )


class RegionStat(BaseModel):
    """시도/시군구별 집계 통계."""

    name: str = Field(..., description="province 또는 district 이름")
    count: int = Field(..., description="해당 지역에 속한 상위 페르소나 수")
    avg_score: float = Field(..., description="해당 지역 평균 반응도")
    top_persona_uuid: str | None = None


# ============================================================
# 모집단 통계 (전체 100만 행 스코어링 결과)
# ============================================================

class CohortStat(BaseModel):
    """percentile 기반 cohort 1개."""

    name: str = Field(..., description="cohort 식별자 (core/target/interest)")
    label: str = Field(..., description="표시용 라벨 (예: '핵심 타겟')")
    percentile: float = Field(..., description="상위 X% (0~100)")
    size: int = Field(..., description="해당 cohort 인원 수")
    min_score: float = Field(..., description="이 cohort에 포함되는 최소 점수")
    avg_score: float = Field(..., description="평균 점수")


class DistributionBin(BaseModel):
    """히스토그램 / 카테고리 분포 1개 막대."""

    label: str
    count: int


class DemographicGroup(BaseModel):
    """Nemotron 인구통계 1개 컬럼의 분포.

    자유 텍스트 컬럼(persona, *_persona, skills_and_expertise,
    hobbies_and_interests, career_goals_and_ambitions)은 카테고리 분포로
    표현할 수 없어 포함하지 않는다.
    """

    column: str = Field(..., description="원본 컬럼명 (예: sex, marital_status)")
    label: str = Field(..., description="표시용 라벨 (예: 성별, 혼인 상태)")
    bins: list[DistributionBin] = Field(..., description="분포 막대 (내림차순)")
    total_unique: int = Field(..., description="해당 컬럼의 전체 고유값 수")
    truncated_to: int | None = Field(
        None,
        description="Top N으로 잘랐다면 N, 아니면 None (즉 bins가 전체)",
    )


class PopulationStats(BaseModel):
    """100만 행 전체 스코어링 결과 + 모집단 통계.

    cohort 정의:
      - core: 상위 0.5% (≈5,000명) — 카드·리포트 컨텍스트로 이미 노출됨
      - target: 상위 5% (≈50,000명) — demographics 집계의 주 모집단
      - interest: 상위 20% (≈200,000명) — 점수 분포 차트 베이스
    """

    total_scored: int = Field(..., description="전체 스코어링된 페르소나 수")
    cohorts: list[CohortStat] = Field(..., description="3단계 cohort 정보")

    score_distribution: list[DistributionBin] = Field(
        ...,
        description="5점 단위 점수 히스토그램 (interest cohort 기준)",
    )
    demographics: list[DemographicGroup] = Field(
        ...,
        description=(
            "Nemotron 카테고리형 컬럼별 분포 (target cohort 기준). "
            "표시 우선순위 순서대로."
        ),
    )
    districts_full: list[RegionStat] = Field(
        default_factory=list,
        description=(
            "타겟 cohort(상위 5%, ≈5만명) 기준 전국 시군구별 집계. "
            "name 형식: '시도-시군구' (예: '경기-광명시'). "
            "지도 choropleth와 Top N 표용. count 내림차순."
        ),
    )


# ============================================================
# 최종 응답
# ============================================================

class AnalyzeResponse(BaseModel):
    """POST /api/analyze 응답."""

    analysis_id: str
    selling_points: SellingPoints
    top_personas: list[PersonaHit]
    bottom_personas: list[PersonaHit] = Field(
        default_factory=list,
        description="전체 점수 하위 N명 (반대 반응 비교용)",
    )
    province_stats: list[RegionStat] = Field(..., description="상위 50명 기준 시도 집계 (카드용)")
    district_stats: list[RegionStat] = Field(
        ..., description="상위 시도의 시군구 집계 (drill-down용)"
    )
    population_stats: PopulationStats = Field(
        ..., description="100만 행 전체 스코어링 기반 모집단 통계"
    )
    top_opinions: list[PersonaOpinion] = Field(
        default_factory=list,
        description="top_personas와 같은 순서로 매칭된 의견 (uuid join도 가능)",
    )
    bottom_opinions: list[PersonaOpinion] = Field(
        default_factory=list,
        description="bottom_personas와 같은 순서로 매칭된 의견",
    )
    report_md: str = Field(..., description="Claude(Haiku) 생성 FP/기획자용 마크다운 리포트")
    elapsed_ms: dict[str, int] = Field(
        ..., description="단계별 소요 ms: selling_points, embed, score, opinions, report"
    )


# ============================================================
# 설문 응답 시뮬레이션 (페르소나 빙의)
# ============================================================

class SimulateRequest(BaseModel):
    """POST /api/simulate 요청 바디."""

    analysis_id: str = Field(..., description="기 분석 ID (top_personas를 재사용)")
    question: str = Field(
        ...,
        min_length=5,
        max_length=300,
        description="페르소나에게 던질 주관식 질문 (5-300자)",
    )
    n_respondents: int = Field(
        5, ge=1, le=100, description="응답자 수 (top_personas 상위 N명, 최대 100명)"
    )
    llm_provider: Literal["anthropic", "sllm"] = Field(
        "sllm",
        description="시뮬레이션에 사용할 LLM provider (anthropic 또는 sllm)",
    )


class PersonaResponse(BaseModel):
    """페르소나 1명의 시뮬레이션 응답."""

    persona_uuid: str
    persona_summary: str = Field(
        ..., description='식별용 한 줄 요약 (예: "남자 45세 · 경기 수원 · 회사원")'
    )
    response_text: str = Field(..., description="페르소나가 자기 말투로 작성한 응답 본문")
    sentiment: Literal["긍정", "중립", "부정"]
    purchase_intent: int = Field(..., ge=1, le=5, description="가입 의향 1-5")
    key_concern: str | None = Field(
        None, description="주요 우려·관심사 한 줄 (없으면 None)"
    )


class SimulateResponse(BaseModel):
    """POST /api/simulate 응답."""

    simulation_id: str
    analysis_id: str
    question: str
    responses: list[PersonaResponse]
    elapsed_ms: dict[str, int] = Field(
        ..., description="단계별 소요 ms: simulate, persist, total"
    )


# ============================================================
# A/B 테스트 — 두 안 비교 (당사 정보 기반 장단점 + FP 전략)
# ============================================================

ABTestInputMode = Literal["terms", "marketing", "concept"]
"""A/B 입력 형태."""

ABChallengerKind = Literal["internal", "external"]
"""도전안(기준이 아닌 쪽)의 성격.

- internal: 당사 다른 상품 (당사 내부 비교 — 기존 상품 vs 신상품 등)
- external: 타사 상품 (경쟁 분석)
"""


class ABTestVariantInput(BaseModel):
    """A/B 테스트 한 안의 입력."""

    label: str = Field(
        ...,
        min_length=1,
        max_length=40,
        description='안의 별명 (예: "현재안", "리뉴얼안"). 결과 표·리포트에 그대로 노출.',
    )
    text: str = Field(
        ...,
        min_length=20,
        max_length=20_000,
        description="해당 안의 본문 (약관/카피/컨셉 요약 등 — input_mode와 무관하게 같은 분석 파이프라인 통과)",
    )


class ABTestRequest(BaseModel):
    """POST /api/abtest 요청."""

    company_context: str = Field(
        ...,
        min_length=10,
        max_length=2_000,
        description="당사 정보 (브랜드/포지셔닝/KPI/차별점). 장단점·FP 전략 LLM의 핵심 컨텍스트.",
    )
    input_mode: ABTestInputMode = Field(
        "terms",
        description="입력 형태 — terms(약관/설명서) / marketing(카피·광고) / concept(컨셉+보장 요약). 프롬프트 톤 힌트.",
    )
    variant_a: ABTestVariantInput
    variant_b: ABTestVariantInput
    baseline_variant: Literal["A", "B"] = Field(
        "A",
        description=(
            "당사 안(기준안)으로 간주할 쪽. 다른 쪽은 비교·검토 대상. "
            "LLM의 장단점·전략 분석에서 '당사 안 vs 도전안' 관점 차이를 만든다."
        ),
    )
    challenger_kind: ABChallengerKind = Field(
        "internal",
        description=(
            "도전안(기준이 아닌 쪽)의 성격. "
            "internal=당사 다른 상품(내부 비교), external=타사 상품(경쟁 분석). "
            "LLM이 외부 위협/벤치마크 관점을 적용할지, 내부 포트폴리오 관점을 적용할지 결정."
        ),
    )
    llm_provider: Literal["anthropic", "sllm"] = Field(
        "sllm", description="사용 LLM provider"
    )
    top_k: int = Field(
        50,
        ge=5,
        le=100,
        description="각 안에서 반환할 상위 페르소나 수 (A·B 동일)",
    )


class ABVariantResult(BaseModel):
    """A 또는 B 한 안의 분석 결과 (단일 /api/analyze 응답의 축약형)."""

    label: str = Field(..., description="입력 시 지정한 별명 (UI 표시 기준)")
    selling_points: SellingPoints
    top_personas: list[PersonaHit]
    province_stats: list[RegionStat] = Field(default_factory=list)
    population_stats: PopulationStats
    top_opinions: list[PersonaOpinion] = Field(default_factory=list)


class ComparisonRow(BaseModel):
    """A vs B 비교 표 한 행."""

    key: str = Field(..., description="식별자 (예: 'avg_score', 'core_size')")
    label: str = Field(..., description="표시 라벨 (예: '평균 반응도 점수')")
    a_value: str = Field(..., description="A 값을 포매팅한 문자열")
    b_value: str = Field(..., description="B 값을 포매팅한 문자열")
    delta: str = Field(..., description="차이를 포매팅한 문자열 (예: '+4.5 (B 우위)' 또는 '분기')")
    winner: Literal["A", "B", "tie"] = Field(
        "tie", description="이 지표 한정 승자. 수치 비교 불가(분기 등)면 'tie'."
    )


class ABComparison(BaseModel):
    """A vs B 정형 비교 데이터 (LLM 미사용, 순수 계산)."""

    summary_table: list[ComparisonRow]
    category_diff: dict[str, dict[str, float]] = Field(
        default_factory=dict,
        description="페르소나 카테고리별 가중치 diff. {'family': {'a': 0.55, 'b': 0.20, 'delta': -0.35}, ...}",
    )


class ABTestResponse(BaseModel):
    """POST /api/abtest 응답."""

    abtest_id: str
    input_mode: ABTestInputMode
    company_context: str = Field(
        ..., description="요청 시 입력된 당사 정보 (영속화·재표시용)"
    )
    baseline_variant: Literal["A", "B"] = Field(
        "A", description="당사 안(기준안)으로 지정된 쪽"
    )
    challenger_kind: ABChallengerKind = Field(
        "internal", description="도전안의 성격 (internal=당사 다른 상품, external=타사 상품)"
    )
    variant_a: ABVariantResult
    variant_b: ABVariantResult
    comparison: ABComparison
    company_insights_md: str = Field(
        ..., description="당사 정보 중심 A/B 장단점 마크다운 (LLM 생성)"
    )
    fp_strategy_md: str = Field(
        ..., description="FP 판매전략 마크다운 — 타겟별 어프로치 스크립트 + 채널 추천 (LLM 생성)"
    )
    recommended_variant: Literal["A", "B", "split"] = Field(
        ..., description="추천안. 'split'은 타겟별 분기 운영 권장."
    )
    elapsed_ms: dict[str, int] = Field(
        ...,
        description=(
            "단계별 ms: extract_a, extract_b, embed_a, embed_b, score_a, score_b, "
            "opinions_a, opinions_b, compare, insights, strategy, total"
        ),
    )
