"""설문 CRUD API.

엔드포인트:
  POST   /api/surveys                 — 신규 설문 생성 (draft)
  GET    /api/surveys                 — 목록 (인덱스 기반, status 필터)
  GET    /api/surveys/{survey_id}     — 단건 조회
  PUT    /api/surveys/{survey_id}     — 전체 갱신
  DELETE /api/surveys/{survey_id}     — 삭제 (세션 포함)
"""

from __future__ import annotations

import logging
import random
import uuid as _uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field

from models.survey import (
    ExecutionConfig,
    Question,
    Survey,
    SurveyStatus,
    TargetFilter,
)
from services import survey_repo
from services.llm import (
    generate_survey_placeholders,
    generate_survey_questions,
    resolve_sllm_model,
)
from services.pii_mask import mask_pii

logger = logging.getLogger("personafit.surveys")

router = APIRouter(prefix="/api/surveys", tags=["surveys"])


# ============================================================
# 요청 스키마
# ============================================================


class SurveyCreateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field("", max_length=2000)
    objective: str = Field("", max_length=2000)
    target_filter: TargetFilter
    execution: ExecutionConfig
    questions: list[Question] = Field(default_factory=list)
    persona_uuids: list[str] = Field(default_factory=list)


class SurveyListResponse(BaseModel):
    items: list[dict]
    total: int
    limit: int
    offset: int


# ============================================================
# 엔드포인트
# ============================================================


@router.post("", response_model=Survey, status_code=201)
def create_survey(req: SurveyCreateRequest) -> Survey:
    now = datetime.now(UTC)
    survey = Survey(
        id="",  # repo에서 uuid 발급
        title=req.title,
        description=req.description,
        objective=req.objective,
        status="draft",
        target_filter=req.target_filter,
        execution=req.execution,
        questions=req.questions,
        persona_uuids=req.persona_uuids,
        created_at=now,
        updated_at=now,
    )
    try:
        return survey_repo.create_survey(survey)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("", response_model=SurveyListResponse)
def list_surveys_endpoint(
    status: SurveyStatus | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> SurveyListResponse:
    items, total = survey_repo.list_surveys(status=status, limit=limit, offset=offset)
    return SurveyListResponse(items=items, total=total, limit=limit, offset=offset)


# 설문 placeholder 예시 — 작성 폼 입력칸 힌트를 매번 LLM으로 신선하게 생성.
# ⚠️ 라우트 순서 주의: 정적 경로라 동적 "/{survey_id}"보다 먼저 등록해야 가로채이지 않는다.
_PLACEHOLDER_CATEGORIES = [
    # 금융·보험 (편중 완화를 위해 세분화하되 비중은 일부만)
    "건강·실손보험", "자동차보험", "연금·노후 준비", "신용카드 혜택", "대출·금융 상품",
    "디지털 간편보험", "핀테크·간편결제", "자산관리·투자(주식·ETF)", "청년 자산형성(청약·적금)",
    # 음식·소비
    "배달·외식", "카페·디저트", "간편식·밀키트", "온라인 쇼핑", "중고거래·리셀",
    "패션·SPA 브랜드", "명품·하이엔드 소비", "뷰티·화장품",
    # 여가·콘텐츠
    "여행·숙박", "OTT·구독 서비스", "게임·e스포츠", "웹툰·웹소설",
    "음악 스트리밍·공연", "숏폼·크리에이터 콘텐츠", "캠핑·아웃도어", "사진·취미·공예",
    # 건강·라이프
    "헬스·운동", "러닝·홈트레이닝", "건강관리·웰니스", "정신건강·스트레스 관리",
    "반려동물", "주거·인테리어",
    # 라이프스테이지
    "육아·키즈", "결혼 준비", "1인 가구 생활", "시니어 돌봄·실버 라이프",
    # 일·자기계발
    "직장 문화·복지", "이직·커리어 전환", "재택·하이브리드 근무", "부업·N잡",
    "교육·자기계발",
    # 이동·사회
    "모빌리티·대중교통", "전기차·친환경 모빌리티", "친환경·ESG 소비",
    "지역 생활·동네 상권", "모바일 앱 사용 습관",
]

_FALLBACK_PLACEHOLDER = {
    "title": "30대 직장인의 점심 식사 만족도",
    "description": "사내 식당 메뉴 다양성 부족 가설을 검증",
    "objective": "메뉴 다양성·가격·접근성 중 만족도를 좌우하는 핵심 요인을 파악",
}


@router.get("/placeholder-examples")
def placeholder_examples(response: Response) -> dict:
    """설문 작성 폼 placeholder 예시 1세트(제목·설명·목적). 매 호출 다른 분야로 생성.

    placeholder는 부가 기능이라 LLM 실패 시 고정 폴백 예시로 graceful degradation한다.
    매 호출 다른 예시를 보장하기 위해 캐시를 끈다(브라우저/프록시 GET 캐시 방지).
    """
    response.headers["Cache-Control"] = "no-store"
    category = random.choice(_PLACEHOLDER_CATEGORIES)
    try:
        result = generate_survey_placeholders(category)
        # 누락 필드는 폴백으로 보충 (부분 응답 방어)
        return {k: (result.get(k) or _FALLBACK_PLACEHOLDER[k]) for k in _FALLBACK_PLACEHOLDER}
    except Exception as e:
        logger.warning("placeholder 생성 실패, 폴백 사용: %s", e)
        return dict(_FALLBACK_PLACEHOLDER)


@router.get("/sllm-model")
def sllm_model_info() -> dict:
    """현재 sLLM 게이트웨이가 실제 호스팅 중인 모델명 (SSOT).

    프론트(설문 생성 폼)가 모델명을 하드코딩하지 않고 이 값을 단일 출처로 사용한다.
    서버가 모델을 교체해도 자동으로 따라가 표시-실제 불일치를 원천 차단한다.
    ⚠️ 라우트 순서 주의: 정적 경로라 동적 "/{survey_id}"보다 먼저 등록해야 가로채이지 않는다.
    조회 실패(백엔드 미기동 등) 시 502 — 프론트는 폴백 라벨을 표시한다.
    """
    try:
        return {"model": resolve_sllm_model()}
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@router.get("/{survey_id}", response_model=Survey)
def get_survey_endpoint(survey_id: str) -> Survey:
    survey = survey_repo.get_survey(survey_id)
    if survey is None:
        raise HTTPException(status_code=404, detail="survey not found")
    return survey


@router.put("/{survey_id}", response_model=Survey)
def update_survey_endpoint(survey_id: str, req: SurveyCreateRequest) -> Survey:
    existing = survey_repo.get_survey(survey_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="survey not found")
    if existing.status not in ("draft", "failed"):
        raise HTTPException(
            status_code=409,
            detail=f"실행 중이거나 완료된 설문은 수정할 수 없습니다 (status={existing.status})",
        )
    updated = Survey(
        id=survey_id,
        title=req.title,
        description=req.description,
        objective=req.objective,
        status=existing.status,  # 상태는 별도 액션으로만 변경
        target_filter=req.target_filter,
        execution=req.execution,
        questions=req.questions,
        persona_uuids=req.persona_uuids,
        created_at=existing.created_at,
        updated_at=datetime.now(UTC),
    )
    try:
        return survey_repo.update_survey(updated)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.delete("/{survey_id}", status_code=204)
def delete_survey_endpoint(survey_id: str) -> None:
    if not survey_repo.delete_survey(survey_id):
        raise HTTPException(status_code=404, detail="survey not found")


# ============================================================
# AI 질문 추천 (마법사 Step 3에서 호출)
# ============================================================


class SuggestQuestionsRequest(BaseModel):
    title: str = Field("", max_length=200)
    description: str = Field("", max_length=2000)
    objective: str = Field("", max_length=2000)
    target_filter: TargetFilter | None = None
    num: int = Field(5, ge=1, le=8)
    existing_question_texts: list[str] = Field(default_factory=list, max_length=20)
    start_order: int = Field(1, ge=1, description="첫 추천 질문의 order (기존 질문 다음부터)")


class SuggestQuestionsResponse(BaseModel):
    questions: list[Question]


def _target_summary(tf: TargetFilter | None) -> str:
    """TargetFilter → LLM에 전달할 자연어 요약 (메타 + 자연어 query)."""
    if tf is None:
        return ""
    parts: list[str] = []
    if tf.query:
        parts.append(f"자연어 조건: {tf.query}")
    if tf.age_min is not None or tf.age_max is not None:
        lo = tf.age_min if tf.age_min is not None else "?"
        hi = tf.age_max if tf.age_max is not None else "?"
        parts.append(f"연령: {lo}-{hi}세")
    if tf.sex:
        parts.append(f"성별: {', '.join(tf.sex)}")
    if tf.provinces:
        parts.append(f"지역: {', '.join(tf.provinces[:5])}")
    if tf.occupations:
        parts.append(f"직업: {', '.join(tf.occupations)}")
    if tf.education_levels:
        parts.append(f"학력: {', '.join(tf.education_levels)}")
    if tf.sample_size:
        parts.append(f"샘플 크기: {tf.sample_size}명")
    return " · ".join(parts)


@router.post("/suggest-questions", response_model=SuggestQuestionsResponse)
def suggest_questions(req: SuggestQuestionsRequest) -> SuggestQuestionsResponse:
    """제목·목적·대상자를 바탕으로 AI가 질문 N개를 추천.

    호출 시점: 마법사 Step 3에서 "AI 추천" 버튼.
    출력: SurveyQuestion[] (id·order 자동 할당, validate 통과 보장).
    """
    if not (req.title or req.objective or req.description or (req.target_filter and req.target_filter.query)):
        raise HTTPException(
            status_code=400,
            detail="제목·설명·목적·대상자 중 최소 1개는 입력해야 합니다",
        )

    try:
        raw = generate_survey_questions(
            title=mask_pii(req.title),
            description=mask_pii(req.description),
            objective=mask_pii(req.objective),
            target_summary=mask_pii(_target_summary(req.target_filter)),
            num=req.num,
            existing_question_texts=(
                [mask_pii(t) for t in req.existing_question_texts]
                if req.existing_question_texts
                else None
            ),
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI 추천 실패: {e}") from e

    # Question 모델로 변환 + id·order 채우기 + 검증 통과 보장
    questions: list[Question] = []
    for i, r in enumerate(raw):
        try:
            q = Question(
                id=str(_uuid.uuid4()),
                order=req.start_order + i,
                type=r["type"],
                text=r["text"],
                options=r.get("options") or [],
                scale_min=r.get("scale_min"),
                scale_max=r.get("scale_max"),
                scale_label_low=r.get("scale_label_low"),
                scale_label_high=r.get("scale_label_high"),
                required=bool(r.get("required", True)),
            )
            questions.append(q)
        except Exception:
            # 검증 실패한 항목은 건너뛰기 (Question 모델 validator로 보호)
            continue

    return SuggestQuestionsResponse(questions=questions)
