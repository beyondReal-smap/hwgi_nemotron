"""설문 시뮬레이션 플랫폼 — 핵심 데이터 모델.

스펙 §3 기반. JSON 영속화 대상이므로 모든 필드는 직렬화 안전.
프론트 lib/api.ts와 1:1 동기화 필수.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

# ============================================================
# 공통 enum 유사 타입
# ============================================================

QuestionType = Literal["single_choice", "multi_choice", "scale", "open_ended", "nps"]
SurveyStatus = Literal["draft", "running", "completed", "failed"]
SessionStatus = Literal["pending", "running", "completed", "failed"]
SamplingMode = Literal["all", "random_n", "proportional"]
LLMProvider = Literal["anthropic", "sllm"]


# ============================================================
# 질문 (Question)
# ============================================================

class Question(BaseModel):
    """설문 1문항.

    유형별 필드 사용:
      - single_choice / multi_choice: options 필수 (최소 2개)
      - scale: scale_min/scale_max 필수 (예: 1-5, 1-7)
      - open_ended: 추가 필드 없음
      - nps: scale_min=0, scale_max=10 고정
    """

    id: str = Field(..., description="uuid4")
    order: int = Field(..., ge=1, description="1-based 노출 순서")
    type: QuestionType
    text: str = Field(..., min_length=1, max_length=500)
    options: list[str] = Field(default_factory=list, max_length=20)
    scale_min: int | None = Field(None, ge=0, le=10)
    scale_max: int | None = Field(None, ge=0, le=10)
    scale_label_low: str | None = Field(None, max_length=20)
    scale_label_high: str | None = Field(None, max_length=20)
    required: bool = True

    @model_validator(mode="after")
    def _validate_by_type(self) -> "Question":
        if self.type in ("single_choice", "multi_choice"):
            if len(self.options) < 2:
                raise ValueError(f"{self.type}은 최소 2개의 옵션이 필요합니다")
        elif self.type == "scale":
            if self.scale_min is None or self.scale_max is None:
                raise ValueError("scale은 scale_min/scale_max가 필요합니다")
            if self.scale_min >= self.scale_max:
                raise ValueError("scale_min < scale_max")
        elif self.type == "nps":
            # NPS는 0-10 고정으로 정규화
            self.scale_min = 0
            self.scale_max = 10
        return self


# ============================================================
# 대상자 선별 조건 (TargetFilter)
# ============================================================

class TargetFilter(BaseModel):
    """페르소나 선별 조건 — /api/dataset/personas/filter 입력과 호환."""

    age_min: int | None = Field(None, ge=0, le=120)
    age_max: int | None = Field(None, ge=0, le=120)
    sex: list[str] = Field(default_factory=list)
    provinces: list[str] = Field(default_factory=list)
    family_types: list[str] = Field(default_factory=list)
    education_levels: list[str] = Field(default_factory=list)
    occupations: list[str] = Field(default_factory=list)
    query: str | None = Field(None, max_length=500)
    sampling: SamplingMode = "random_n"
    sample_size: int = Field(100, ge=1, le=10000)


# ============================================================
# 실행 설정 (ExecutionConfig)
# ============================================================

class ExecutionConfig(BaseModel):
    """LLM 실행 파라미터."""

    llm_provider: LLMProvider = "anthropic"
    model: str = "claude-haiku-4-5"
    temperature: float = Field(0.7, ge=0.0, le=2.0)
    include_reasoning: bool = True


# ============================================================
# 답변·세션 (Answer / ResponseSession)
# ============================================================

class Answer(BaseModel):
    """단일 페르소나 × 단일 질문의 응답."""

    question_id: str
    # 유형별:
    #   - single_choice: 선택지 텍스트 (str)
    #   - multi_choice: 선택지 텍스트 배열 (list[str])
    #   - scale/nps: 점수 (int)
    #   - open_ended: 자유 텍스트 (str)
    answer_value: str | int | list[str]
    reasoning: str = Field("", max_length=200)
    confidence: float = Field(0.0, ge=0.0, le=1.0)


class ResponseSession(BaseModel):
    """단일 페르소나의 설문 응답 세션."""

    id: str = Field(..., description="{survey_id}:{persona_uuid} 합성")
    survey_id: str
    persona_uuid: str
    status: SessionStatus = "pending"
    started_at: datetime | None = None
    completed_at: datetime | None = None
    llm_model_used: str = ""
    total_tokens: int = 0
    error: str | None = None
    answers: list[Answer] = Field(default_factory=list)


# ============================================================
# 설문 (Survey)
# ============================================================

class Survey(BaseModel):
    """설문 본체. 마법사 Step 1~4의 결과물."""

    id: str
    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field("", max_length=2000)
    objective: str = Field("", max_length=2000, description="조사 목적 (LLM 응답 품질 향상에 활용)")
    status: SurveyStatus = "draft"
    target_filter: TargetFilter
    execution: ExecutionConfig
    questions: list[Question] = Field(default_factory=list)
    persona_uuids: list[str] = Field(default_factory=list, description="Step 2 확정 시점의 페르소나 스냅샷")
    created_at: datetime
    updated_at: datetime


# ============================================================
# 세그먼트 (Segment) — 저장된 페르소나 그룹
# ============================================================

class Segment(BaseModel):
    """저장된 페르소나 세그먼트. 마법사 Step 2에서 불러옴."""

    id: str
    name: str = Field(..., min_length=1, max_length=100)
    description: str = Field("", max_length=500)
    filter: TargetFilter
    persona_uuids: list[str] = Field(..., min_length=1, max_length=10000)
    # size는 persona_uuids로부터 자동 계산 (입력 없어도 됨, 있으면 덮어씀)
    size: int = 0
    created_at: datetime

    @model_validator(mode="after")
    def _ensure_size(self) -> "Segment":
        self.size = len(self.persona_uuids)
        return self
