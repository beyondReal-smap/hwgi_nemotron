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
    llm_provider: Literal["anthropic", "sllm", "openai"] = Field(
        "sllm",
        description=(
            "사용할 LLM provider. anthropic=Claude Sonnet+Haiku, "
            "sllm=OpenAI 호환 sLLM (모델명은 SLLM_MODEL env 또는 /v1/models 자동 감지)"
        ),
    )


# ============================================================
# 소구점 추출 결과
# ============================================================

class SellingPoints(BaseModel):
    """LLM이 상품 텍스트에서 추출한 분석 결과 (anthropic provider 시 Claude Sonnet, 현재 enforce_provider로 사내 sLLM 고정).

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
    score: float = Field(..., description="0-100 정규화 반응도 점수 (raw, LLM 톤·UI 색상의 기준)")
    # 모집단 100만 명 안에서의 이 페르소나의 순위 백분위 (0~100, 100=최상위).
    # raw score는 cosine 분포 특성상 [52,78]로 좁아 사용자 직관과 어긋남 →
    # 사용자 친화적 보조 라벨('상위 0.1%' 등)용. 옛 분석은 None.
    percentile_score: float | None = Field(
        None,
        ge=0,
        le=100,
        description="모집단 내 백분위 (100=최상위 1명, 50=중위). 옛 분석은 None",
    )
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
    # per-capita(농도) — 옵셔널, 옛 이력 호환. 타겟 인원을 그 지역 전체 모집단 인원으로
    # 나눈 농도를 전국 평균 농도와 비교한 배수. 인원 1위는 항상 대도시(인구 자체가 많음)라
    # 뻔하지만, 농도 lift는 '인구 대비 반응이 진한' 숨은 공략 핫스팟을 드러낸다.
    population_count: int | None = Field(
        None, description="해당 지역 전체 모집단 인원 (농도 분모)"
    )
    lift_ratio: float | None = Field(
        None,
        description=(
            "지역 타겟 농도 / 전국 평균 농도 — 1.0=전국 평균, >1=인구 대비 과집중. "
            "분모(모집단 인원) 작은 소지역은 아티팩트 주의"
        ),
    )


# ============================================================
# 모집단 통계 (전체 100만 행 스코어링 결과)
# ============================================================

class CohortStat(BaseModel):
    """절대 점수 컷 기반 cohort 1개.

    raw 점수 분포 의미를 카드에 그대로 노출하기 위해 절대 점수 컷(85/75/65)만
    적용한다. 과거에는 인원 부족/과다 시 percentile 폴백을 적용했으나,
    "≥85 인원이 폴백으로 5,001명에 캡되어 분포 정보가 가려지는" 문제가 있어 제거.
    """

    name: str = Field(..., description="cohort 식별자 (core/target/interest)")
    label: str = Field(..., description="표시용 라벨 (예: '핵심 타겟')")
    percentile: float = Field(
        ...,
        description="참조용 percentile 표기 (옛 분석 이력 호환). 절대 컷에서는 미사용.",
    )
    size: int = Field(..., description="해당 cohort 인원 수")
    min_score: float = Field(..., description="이 cohort에 포함되는 최소 점수")
    avg_score: float = Field(..., description="평균 점수")
    mode: str = Field(
        "absolute",
        description="컷 방식. 현재는 항상 'absolute'. 'percentile'은 옛 이력 호환용.",
    )
    threshold_absolute: float = Field(
        ...,
        description="이 cohort의 절대 점수 임계값. mode와 무관하게 항상 노출.",
    )


class DistributionBin(BaseModel):
    """히스토그램 / 카테고리 분포 1개 막대."""

    label: str
    count: int
    # baseline-lift (옵셔널, 옛 jsonl 호환). 타겟 cohort 분포를 '전체 100만 모집단'
    # 분포와 비교해 '이 값이 전국 평균 대비 몇 배 몰렸나'를 보여주기 위한 메타.
    # 절대 비율(흔한 통계)을 '과대/과소 표집'이라는 발견적 인사이트로 격상한다.
    share: float | None = Field(
        None, description="이 값이 타겟 cohort 전체에서 차지하는 비율 (count/target_total, 0~1)"
    )
    baseline_share: float | None = Field(
        None, description="이 값이 전체 모집단에서 차지하는 비율 (0~1)"
    )
    lift_ratio: float | None = Field(
        None,
        description=(
            "share / baseline_share — 1.0=전국과 동일, >1=과대표집(타겟 집중), "
            "<1=과소표집. baseline 0이면 None"
        ),
    )


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


class ScoreDriver(BaseModel):
    """점수 분해 한 항 (Score DNA) — core cohort 점수가 어느 요인에서 왔나.

    score_all_personas의 가산식
      raw = cosine_score + W_RULE_PT*(rule-0.5) + W_CAT_PT*(cat-0.5) + W_INSUR_PT*insur
    의 각 항을 core cohort에서 평균내고 모집단 평균과의 delta를 함께 제공한다.
    가산 구조라 항 합 = 점수(soft-ceiling 전)와 수학적으로 정합 — 휴리스틱 아님, LLM 0콜.
    옛 분석 이력엔 부재(Optional).
    """

    key: str = Field(..., description="요인 식별자: cosine|rule|category|insurance")
    label: str = Field(..., description="표시 라벨: 의미 적합도|인구통계 적합|관심사 적합|보험 관심")
    core_contribution: float = Field(
        ..., description="core cohort 평균에서 이 항이 차지하는 점수 기여(절대)"
    )
    pop_contribution: float = Field(
        ..., description="전체 모집단 평균에서 이 항의 점수 기여(절대)"
    )
    delta: float = Field(
        ...,
        description="core_contribution - pop_contribution. core를 모집단 위로 끌어올린 정도(+/-)",
    )


class ConfidenceStats(BaseModel):
    """점추정에 붙는 불확실성 — 평균 95% 신뢰구간 + 컷 민감도.

    cohort 평균은 해석적 표준오차(std/√n, 95%=±1.96·SE)로 산출 — 1M 규모라 즉시·정확.
    컷 민감도는 절대 점수 컷을 ±1점 흔들 때 인원 변화를 직접 카운트.
    '점수 82±0.4', 'core 컷 81→80이면 +6,200명'처럼 정직성을 노출한다. 옛 이력 부재(Optional).
    """

    core_mean: float = Field(..., description="core cohort 평균 점수")
    core_ci_low: float = Field(..., description="core 평균 95% 신뢰구간 하한")
    core_ci_high: float = Field(..., description="core 평균 95% 신뢰구간 상한")
    target_mean: float = Field(..., description="target cohort 평균 점수")
    target_ci_low: float = Field(..., description="target 평균 95% 신뢰구간 하한")
    target_ci_high: float = Field(..., description="target 평균 95% 신뢰구간 상한")
    core_cut: float = Field(..., description="core 절대 점수 컷(기준)")
    core_size: int = Field(..., description="현재 컷 기준 core 인원")
    core_size_relaxed: int = Field(..., description="컷 -1점 시 core 인원(증가분 관찰)")
    core_size_tightened: int = Field(..., description="컷 +1점 시 core 인원(감소분 관찰)")


class SegmentFinding(BaseModel):
    """교차 세그먼트 발굴 1건 — 단변량 분포가 못 잡는 상호작용 조합.

    버려지던 cohort_indices(target) 위에서 2~3개 인구통계 차원을 groupby 교차해
    '전국 대비 가장 진하게 몰린' 조합을 lift_ratio 순으로 추출한다. LLM 0콜.
    예: {age_bucket:'40대', family_type:'배우자·자녀와 거주', province:'경기'} → 3.4배 집중.
    """

    dimensions: dict[str, str] = Field(
        ..., description="조합을 이루는 차원별 값 {컬럼: 값}"
    )
    label: str = Field(..., description="사람이 읽는 한 줄 (예: '40대 · 유자녀 · 경기')")
    target_count: int = Field(..., description="이 조합의 타겟 cohort 인원")
    population_count: int = Field(..., description="이 조합의 전체 모집단 인원")
    share: float = Field(..., description="타겟 cohort 내 이 조합의 비율(0~1)")
    baseline_share: float = Field(..., description="전체 모집단 내 이 조합의 비율(0~1)")
    lift_ratio: float = Field(
        ..., description="share/baseline_share — 전국 대비 집중 배수(>1=과집중)"
    )
    avg_score: float = Field(..., description="이 조합 페르소나의 평균 반응도 점수")


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

    # ------------------------------------------------------------
    # raw 점수 분포 통계 (PR-1 신설, 옛 jsonl 호환 위해 모두 옵셔널)
    # ------------------------------------------------------------
    # 신설 배경: raw score 분포가 [52,78]에 좁게 몰려 100점 척도 의미가 약함.
    # cohort 인원만으로는 안 간 매력도 차이가 보이지 않아, 모집단 전체의 분포·
    # 절대 임계값 통과 인원·core lift 등 raw 메타를 함께 노출한다.
    raw_mean: float | None = Field(
        None, description="모집단 전체 raw score 평균"
    )
    raw_std: float | None = Field(
        None, description="모집단 전체 raw score 표준편차"
    )
    raw_p50: float | None = Field(None, description="raw score 중위값")
    raw_p95: float | None = Field(None, description="raw score 상위 5% 컷")
    raw_p99: float | None = Field(None, description="raw score 상위 1% 컷")
    raw_max: float | None = Field(None, description="raw score 최대값")
    n_above_80: int | None = Field(
        None, description="raw ≥80 인원 (UI/LLM이 '매우 높음'으로 해석하는 컷)"
    )
    n_above_65: int | None = Field(
        None, description="raw ≥65 인원 ('높음' 컷)"
    )
    core_lift: float | None = Field(
        None,
        description="core cohort 평균 점수 − 모집단 평균. core가 모집단 대비 얼마나 높은지",
    )
    target_lift: float | None = Field(
        None, description="target cohort 평균 점수 − 모집단 평균"
    )
    quality_flags: list[str] = Field(
        default_factory=list,
        description=(
            "분포·cohort 품질 경고 플래그. 비어 있으면 정상. "
            "예) 'distribution_narrow', 'core_low_lift', 'mode_inconsistent'"
        ),
    )
    scoring_version: str = Field(
        "v2_hybrid",
        description=(
            "점수 산출 체계 버전. 'v2_hybrid'=분석내 z-score+제품 오프셋(2026-05-29~). "
            "옛 레코드는 이 필드 부재 → 읽는 쪽에서 'v1'(percentile-rank 균등매핑)로 간주."
        ),
    )

    # ------------------------------------------------------------
    # 유리상자(Explainability) 신설 — 모두 Optional(옛 jsonl 호환)
    # ------------------------------------------------------------
    score_drivers: list[ScoreDriver] = Field(
        default_factory=list,
        description=(
            "Score DNA — core cohort 점수가 의미/인구통계/관심사/보험관심 중 무엇에서 떴는지 "
            "가산식 항 단위 분해. 비어 있으면 옛 이력 또는 0-쿼리."
        ),
    )
    confidence: ConfidenceStats | None = Field(
        None,
        description="cohort 평균 95% 신뢰구간 + 컷 민감도. 옛 이력은 None.",
    )


# ============================================================
# 최종 응답
# ============================================================

class AnalyzeResponse(BaseModel):
    """POST /api/analyze 응답."""

    analysis_id: str
    selling_points: SellingPoints
    top_personas: list[PersonaHit]
    mid_personas: list[PersonaHit] = Field(
        default_factory=list,
        description="전체 점수 중위 N명 (median 근처 ±N/2 — 평균 시장 반응)",
    )
    bottom_personas: list[PersonaHit] = Field(
        default_factory=list,
        description="전체 점수 하위 N명 (반대 반응 비교용)",
    )
    province_stats: list[RegionStat] = Field(..., description="상위 N명 기준 시도 집계 (카드용)")
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
    mid_opinions: list[PersonaOpinion] = Field(
        default_factory=list,
        description="mid_personas와 같은 순서로 매칭된 의견",
    )
    bottom_opinions: list[PersonaOpinion] = Field(
        default_factory=list,
        description="bottom_personas와 같은 순서로 매칭된 의견",
    )
    report_md: str = Field(..., description="FP/기획자용 마크다운 리포트 (provider별 생성; 현재 enforce_provider로 사내 sLLM 고정)")
    segments: list[SegmentFinding] = Field(
        default_factory=list,
        description=(
            "타겟 cohort 교차 세그먼트 발굴 — 단변량 분포가 못 잡는 상호작용 조합을 "
            "전국 대비 집중 배수(lift) 순으로. LLM 0콜. 옛 이력은 빈 배열."
        ),
    )
    elapsed_ms: dict[str, int] = Field(
        ..., description="단계별 소요 ms: selling_points, embed, score, opinions, report"
    )


# ============================================================
# What-if 실험실 — 기 분석 위에서 타겟·가중치만 바꿔 즉시 재점수 (임베딩 0콜)
# ============================================================

class WhatIfRequest(BaseModel):
    """POST /api/whatif 요청.

    analysis_id의 저장된 selling_points를 베이스로, 아래 override 필드 중 지정된 것만
    덮어써 재점수한다. None(미지정)은 원본 유지, 빈 배열([])은 명시적 해제.
    target_keywords/summary는 바꾸지 않으므로 query 임베딩은 캐시 hit(0ms) → cosine 84ms +
    rule/cat 재계산만으로 100만 분포·cohort·세그먼트가 즉시 갱신된다.
    """

    analysis_id: str = Field(..., description="기 분석 ID (저장된 selling_points 베이스)")
    target_age_min: int | None = Field(None, ge=0, le=120)
    target_age_max: int | None = Field(None, ge=0, le=120)
    target_sex: list[str] | None = Field(None, description="None=원본 유지, []=성별 무관")
    target_family_types: list[str] | None = None
    target_education_levels: list[str] | None = None
    target_occupations: list[str] | None = None
    persona_category_weights: dict[str, float] | None = Field(
        None, description="6개 카테고리 가중치 전체 교체 (None=원본 유지)"
    )


class WhatIfResponse(BaseModel):
    """POST /api/whatif 응답 — 재점수된 모집단 통계 + 세그먼트 + 상위 페르소나(의견 제외)."""

    population_stats: PopulationStats
    segments: list[SegmentFinding] = Field(default_factory=list)
    top_personas: list[PersonaHit] = Field(
        default_factory=list, description="재점수 상위 페르소나(의견 미생성 — 분포 탐색용)"
    )
    elapsed_ms: dict[str, int] = Field(..., description="embed/score/segments/total")


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
    llm_provider: Literal["anthropic", "sllm", "openai"] = Field(
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
        description=(
            "입력 형태 — terms(약관/설명서) / marketing(카피·광고) / concept(컨셉+보장 요약). "
            "프롬프트 톤 힌트."
        ),
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
    llm_provider: Literal["anthropic", "sllm", "openai"] = Field(
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


class ABOverlap(BaseModel):
    """A/B 두 안의 반응 코호트 겹침(잠식 신호). target 코호트(≥73) 기준.

    겹침은 임베딩 의미 유사도 기반이라 실 구매 잠식이 아닌 '반응 겹침' 신호다.
    """

    a_to_b: float = Field(..., description="A 반응자 중 B에도 반응한 비율(0~1, 비대칭)")
    b_to_a: float = Field(..., description="B 반응자 중 A에도 반응한 비율(0~1, 비대칭)")
    jaccard: float = Field(..., description="두 안 반응자 합집합 대비 교집합(0~1, 대칭)")
    a_size: int = Field(..., description="A target 코호트 인원")
    b_size: int = Field(..., description="B target 코호트 인원")
    relation: Literal["cannibal", "complementary", "neutral"] = Field(
        ...,
        description="겹침 해석: cannibal(잠식·같은 층)·complementary(보완·다른 층)·neutral(중간)",
    )


class OverlapSegment(BaseModel):
    """A/B 반응층 3분할(스윙=교집합 / A전용 / B전용) 1개 + 인구통계 프로파일.

    Jaccard 한 숫자를 '갈아탈 사람의 얼굴'로 풀기 위해, 겹침 교집합/차집합을
    demographics로 분해한다. swing은 양쪽 다 반응(잠식 가능층), a_only/b_only는
    각 안 고유 충성층. LLM 0콜(setdiff/intersect + 분포 집계).
    """

    key: Literal["swing", "a_only", "b_only"] = Field(
        ..., description="swing=교집합(스윙층) / a_only=A전용 / b_only=B전용"
    )
    label: str = Field(..., description="표시 라벨")
    size: int = Field(..., description="이 층 인원")
    demographics: list[DemographicGroup] = Field(
        default_factory=list, description="이 층의 인구통계 분포(전국 baseline-lift 포함)"
    )


class SwingPull(BaseModel):
    """스윙층(양쪽 반응) 내부의 안별 끌림 강도 — 줄다리기 맵.

    교집합 페르소나 각각에서 A 점수 vs B 점수를 직접 비교해, 이 스윙층이 평균적으로
    어느 안으로 기우는지(mean_delta)와 A 선호 비율(a_lean_ratio)을 산출. '중복=무조건
    잠식'이 아니라 '한쪽으로 기운 회수 가능층'임을 정량화한다.
    """

    swing_size: int = Field(..., description="스윙층(교집합) 인원")
    a_mean: float = Field(..., description="스윙층의 A 평균 반응도 점수")
    b_mean: float = Field(..., description="스윙층의 B 평균 반응도 점수")
    a_lean_ratio: float = Field(
        ..., description="스윙층 중 A 점수가 더 높은 인원 비율(0~1). 0.5=완전 박빙"
    )
    mean_delta: float = Field(..., description="a_mean - b_mean. 양수=A로 기움")


class SplitRule(BaseModel):
    """분기 운영 처방 1행 — 한 인구통계 축에서 A/B 각각의 대표 세그먼트.

    split 추천 시 'A로 팔 사람 / B로 팔 사람'을 전용층 분포의 축별 최대 격차로
    자동 분해한다. 집합연산+분포비교라 LLM 없이 골격이 선다.
    """

    dimension: str = Field(..., description="축 라벨 (예: 연령대, 가구 유형)")
    a_segment: str = Field(..., description="A전용층에서 가장 우세한 값")
    a_count: int = Field(..., description="A전용층 내 해당 값 인원")
    b_segment: str = Field(..., description="B전용층에서 가장 우세한 값")
    b_count: int = Field(..., description="B전용층 내 해당 값 인원")


class ABComparison(BaseModel):
    """A vs B 정형 비교 데이터 (LLM 미사용, 순수 계산)."""

    summary_table: list[ComparisonRow]
    category_diff: dict[str, dict[str, float]] = Field(
        default_factory=dict,
        description="페르소나 카테고리별 가중치 diff. {'family': {'a': 0.55, 'b': 0.20, 'delta': -0.35}, ...}",
    )
    overlap: ABOverlap | None = Field(
        None,
        description="A/B 반응층 겹침(잠식 신호). 구버전 이력엔 없을 수 있어 Optional.",
    )
    win_tally: dict[str, int] | None = Field(
        None,
        description=(
            "핵심 수치 지표(평균점수·핵심/타겟 규모·가입의향·긍정비율) 승부 집계 "
            "{'a': 4, 'b': 1, 'tie': 0}. 추천 확신도 스코어보드용. 구버전 이력은 None."
        ),
    )
    overlap_segments: list[OverlapSegment] | None = Field(
        None,
        description="스윙/A전용/B전용 3층의 인구통계 분해(스윙층 X-레이). 구버전은 None.",
    )
    swing_pull: SwingPull | None = Field(
        None, description="스윙층 내부 안별 끌림 강도(줄다리기 맵). 구버전은 None."
    )
    split_playbook: list[SplitRule] | None = Field(
        None,
        description="split 추천 시 'A로 팔 사람/B로 팔 사람' 분기 처방. 비-split이면 None.",
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


# ============================================================
# 잠식 행렬 (Cannibalization Matrix) — N개 안의 반응 코호트 겹침
# ============================================================


class CannibalItemInput(BaseModel):
    """잠식 분석 대상 안(案) 1개."""

    label: str = Field(..., min_length=1, max_length=40, description="안의 별명 (UI 표시 기준)")
    text: str = Field(
        ..., min_length=20, max_length=20_000, description="안 본문(컨셉/카피/약관)"
    )


class CannibalRequest(BaseModel):
    """POST /api/cannibal 요청 — N개 안의 반응 코호트 겹침 행렬."""

    items: list[CannibalItemInput] = Field(
        ..., min_length=2, max_length=8, description="비교할 안 목록 (2~8개)"
    )
    input_mode: ABTestInputMode = Field(
        "concept", description="입력 성격: terms|marketing|concept (소구점 추출 가드)"
    )
    cohort_level: Literal["core", "target", "interest"] = Field(
        "target", description="겹침 산출 기준 반응 코호트 (core≥81/target≥73/interest≥68)"
    )
    llm_provider: Literal["anthropic", "sllm", "openai"] = Field(
        "sllm", description="소구점 추출에 사용할 LLM provider"
    )


class CannibalItemMeta(BaseModel):
    """잠식 행렬 응답의 안별 메타 (행렬 행/열 인덱스 순서와 동일)."""

    label: str = Field(..., description="안의 별명")
    cohort_size: int = Field(..., description="해당 코호트 반응자 수")
    summary: str = Field(..., description="소구점 한 줄 요약")


class CoverageStep(BaseModel):
    """포트폴리오 커버리지 — greedy union 라인업의 한 스텝."""

    rank: int = Field(..., description="라인업 추가 순서(1=가장 큰 코호트)")
    item_index: int = Field(..., description="안 인덱스")
    label: str = Field(..., description="안 별명")
    marginal: int = Field(..., description="이 안 추가로 새로 닿는 인원(marginal lift)")
    cumulative: int = Field(..., description="누적 도달(합집합) 인원")


class MultiplicityBin(BaseModel):
    """노출 다중도 — 각 페르소나가 몇 개 안의 반응층에 속하나."""

    overlap_count: int = Field(..., description="소속 안 개수(1=한 안에만, 2+=중복 노출)")
    persona_count: int = Field(..., description="그런 페르소나 수")


class ExclusiveProfile(BaseModel):
    """전용층 — 오직 한 안에만 반응한 고유층의 프로파일."""

    item_index: int = Field(..., description="안 인덱스")
    label: str = Field(..., description="안 별명")
    exclusive_size: int = Field(..., description="이 안에만 반응한 인원")
    exclusive_ratio: float = Field(
        ..., description="전용/전체코호트 비율 — 분모 아티팩트 보정용"
    )
    demographics: list[DemographicGroup] = Field(
        default_factory=list, description="전용층 인구통계 분포"
    )
    districts: list[RegionStat] = Field(
        default_factory=list, description="전용층 시군구 분포"
    )


class CannibalResponse(BaseModel):
    """POST /api/cannibal 응답 — N×N 겹침 행렬(스칼라만, 인덱스 비노출)."""

    cannibal_id: str = Field(..., description="영속화된 분석 id (이력 재조회용)")
    items: list[CannibalItemMeta] = Field(
        ..., description="안별 메타. 인덱스 순서가 행렬 행/열 순서와 일치."
    )
    directional_matrix: list[list[float]] = Field(
        ...,
        description="M[i][j]=|Ci∩Cj|/|Ci| — i안 반응자 중 j안에도 반응한 비율(비대칭). 대각선 1.",
    )
    jaccard_matrix: list[list[float]] = Field(
        ..., description="J[i][j]=|Ci∩Cj|/|Ci∪Cj| — 대칭 겹침. 대각선 1."
    )
    cohort_level: str = Field(..., description="겹침 산출에 쓰인 코호트 레벨")
    warnings: list[str] = Field(
        default_factory=list,
        description="정직성 경고: small_cohort(소표본) 등. 겹침은 의미 유사도 기반이라 실 구매 잠식 아님.",
    )
    elapsed_ms: dict[str, int] = Field(
        ..., description="단계별 ms: extract, embed, score, matrix, setops, total"
    )
    coverage: list[CoverageStep] | None = Field(
        None,
        description="포트폴리오 커버리지 라인업(greedy union 누적). 구버전 호환 Optional.",
    )
    multiplicity: list[MultiplicityBin] | None = Field(
        None, description="노출 다중도 히스토그램(각 페르소나 소속 안 개수)."
    )
    exclusive_profiles: list[ExclusiveProfile] | None = Field(
        None, description="안별 전용층 프로파일(setdiff demographics/시군구)."
    )
