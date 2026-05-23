"""설문 CRUD API.

엔드포인트:
  POST   /api/surveys                 — 신규 설문 생성 (draft)
  GET    /api/surveys                 — 목록 (인덱스 기반, status 필터)
  GET    /api/surveys/{survey_id}     — 단건 조회
  PUT    /api/surveys/{survey_id}     — 전체 갱신
  DELETE /api/surveys/{survey_id}     — 삭제 (세션 포함)
"""

from __future__ import annotations

import uuid as _uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from models.survey import (
    ExecutionConfig,
    Question,
    Survey,
    SurveyStatus,
    TargetFilter,
)
from services import survey_repo
from services.llm import generate_survey_questions

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
    now = datetime.now(timezone.utc)
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
        updated_at=datetime.now(timezone.utc),
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
            title=req.title,
            description=req.description,
            objective=req.objective,
            target_summary=_target_summary(req.target_filter),
            num=req.num,
            existing_question_texts=req.existing_question_texts or None,
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
