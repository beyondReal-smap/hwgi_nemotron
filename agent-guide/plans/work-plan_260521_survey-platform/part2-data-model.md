# Part 2: 데이터 모델·영속화·CRUD API — Phase 2

> master: [../master.md](../master.md)
> 선행 Part: part1 | 후속 Part: part3
> 담당 Phase: 2 | 변경 파일: 7개 | 상태: 초안

## 목표

- Survey · Question · ResponseSession · Answer · Segment의 Pydantic 모델 정의 + JSON 파일 영속화 + CRUD API 완성. 동시 쓰기 안전(atomic rename) + survey_id 단위 분리 저장.

## 전제 조건

- [ ] part1 완료 (세그먼트 저장 CTA가 호출할 `POST /api/segments` 대상지 존재)
- [ ] 기존 `apps/api/services/persistence.py` 패턴 (atomic write + JSON 파일) 숙지
- [ ] `apps/api/main.py`의 라우터 등록 방식 확인

## 작업 목록

- [ ] `models/survey.py` — Pydantic 모델 5종 (Survey, Question, ResponseSession, Answer, Segment)
- [ ] `services/survey_repo.py` — JSON 영속화 (create/get/list/update/delete)
- [ ] `services/segment_repo.py` — 세그먼트 영속화
- [ ] `routes/surveys.py` — `/api/surveys` CRUD
- [ ] `routes/segments.py` — `/api/segments` CRUD
- [ ] `main.py` — 라우터 등록
- [ ] `lib/api.ts` — 클라이언트 타입·함수 추가

## 변경 예시 (핵심 시그니처만)

**`apps/api/models/survey.py` — 신규**
```python
from typing import Literal
from datetime import datetime
from pydantic import BaseModel, Field

QuestionType = Literal["single_choice", "multi_choice", "scale", "open_ended", "nps"]
SurveyStatus = Literal["draft", "running", "completed", "failed"]

class Question(BaseModel):
    id: str                                        # uuid4
    order: int                                     # 1-based
    type: QuestionType
    text: str = Field(..., min_length=1, max_length=500)
    options: list[str] = Field(default_factory=list)   # 객관식·척도용
    scale_min: int | None = Field(None, ge=0)          # 척도형
    scale_max: int | None = Field(None, le=10)
    required: bool = True

class TargetFilter(BaseModel):
    """페르소나 선별 조건 (part1 필터와 동일 스키마)."""
    age_min: int | None = None
    age_max: int | None = None
    sex: list[str] = Field(default_factory=list)
    provinces: list[str] = Field(default_factory=list)
    occupations: list[str] = Field(default_factory=list)
    family_types: list[str] = Field(default_factory=list)
    query: str | None = None
    sampling: Literal["all", "random_n", "proportional"] = "random_n"
    sample_size: int = Field(100, ge=1, le=10000)

class ExecutionConfig(BaseModel):
    llm_provider: Literal["anthropic", "sllm"] = "anthropic"
    model: str = "claude-haiku-4-5"
    temperature: float = Field(0.7, ge=0.0, le=2.0)
    include_reasoning: bool = True

class Survey(BaseModel):
    id: str
    title: str
    description: str = ""
    objective: str = ""
    status: SurveyStatus = "draft"
    target_filter: TargetFilter
    execution: ExecutionConfig
    questions: list[Question]
    persona_uuids: list[str] = Field(default_factory=list)  # Step 2 확정 시 채움
    created_at: datetime
    updated_at: datetime

class Answer(BaseModel):
    question_id: str
    answer_value: str | int | list[str]           # 유형별
    reasoning: str = ""                           # LLM 근거
    confidence: float = Field(0.0, ge=0.0, le=1.0)

class ResponseSession(BaseModel):
    id: str
    survey_id: str
    persona_uuid: str
    status: Literal["pending", "running", "completed", "failed"] = "pending"
    started_at: datetime | None = None
    completed_at: datetime | None = None
    llm_model_used: str = ""
    total_tokens: int = 0
    error: str | None = None
    answers: list[Answer] = Field(default_factory=list)

class Segment(BaseModel):
    id: str
    name: str
    description: str = ""
    filter: TargetFilter
    persona_uuids: list[str]                      # 저장 시점 확정된 페르소나 ID 스냅샷
    size: int
    created_at: datetime
```

**`apps/api/services/survey_repo.py` — 신규**
```python
import json, os, tempfile, threading, uuid
from pathlib import Path
from datetime import datetime
from models.survey import Survey, ResponseSession

BASE = Path("data/surveys")     # data/surveys/{survey_id}/survey.json + sessions/*.json

_locks: dict[str, threading.Lock] = {}

def _lock(key: str) -> threading.Lock:
    if key not in _locks:
        _locks[key] = threading.Lock()
    return _locks[key]

def _atomic_write(path: Path, data: str) -> None:
    """tmp 파일 → fsync → rename으로 race condition 회피."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp_")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except Exception:
        if os.path.exists(tmp): os.unlink(tmp)
        raise

def create_survey(survey: Survey) -> Survey: ...
def get_survey(survey_id: str) -> Survey | None: ...
def list_surveys(status: str | None = None, limit: int = 50) -> list[Survey]: ...
def update_survey(survey: Survey) -> Survey: ...                    # _lock(survey.id)
def delete_survey(survey_id: str) -> bool: ...
def upsert_session(s: ResponseSession) -> ResponseSession: ...      # _lock(s.survey_id + ":" + s.persona_uuid)
def list_sessions(survey_id: str) -> list[ResponseSession]: ...
def count_sessions(survey_id: str) -> dict[str, int]:               # {"pending": N, "running": N, ...}
    ...
```

**`apps/api/routes/surveys.py` — 신규**
```python
from fastapi import APIRouter, HTTPException
from models.survey import Survey, Question, TargetFilter, ExecutionConfig
from services import survey_repo

router = APIRouter(prefix="/api/surveys", tags=["surveys"])

class SurveyCreateRequest(BaseModel):
    title: str
    description: str = ""
    objective: str = ""
    target_filter: TargetFilter
    execution: ExecutionConfig
    questions: list[Question]

@router.post("", response_model=Survey)
def create_survey(req: SurveyCreateRequest) -> Survey: ...

@router.get("", response_model=list[Survey])
def list_surveys_endpoint(status: str | None = None, limit: int = 50) -> list[Survey]: ...

@router.get("/{survey_id}", response_model=Survey)
def get_survey_endpoint(survey_id: str) -> Survey: ...

@router.put("/{survey_id}", response_model=Survey)
def update_survey_endpoint(survey_id: str, req: SurveyCreateRequest) -> Survey: ...

@router.delete("/{survey_id}", status_code=204)
def delete_survey_endpoint(survey_id: str): ...
```

**`apps/api/routes/segments.py` — 신규**
```python
router = APIRouter(prefix="/api/segments", tags=["segments"])

class SegmentCreateRequest(BaseModel):
    name: str
    description: str = ""
    filter: TargetFilter
    persona_uuids: list[str] = Field(..., min_length=1, max_length=10000)

@router.post("", response_model=Segment)
def create_segment(req: SegmentCreateRequest) -> Segment: ...

@router.get("", response_model=list[Segment])
def list_segments() -> list[Segment]: ...

@router.delete("/{segment_id}", status_code=204)
def delete_segment(segment_id: str): ...
```

**`apps/api/main.py` — 수정**
```python
+ from routes import surveys, segments
+ app.include_router(surveys.router)
+ app.include_router(segments.router)
```

**`apps/web/lib/api.ts` — 수정**
```typescript
// 상응 타입 + 함수 4종
export type Survey = { ... };
export type Segment = { ... };
export async function createSurvey(req: SurveyCreateRequest): Promise<Survey>;
export async function listSurveys(status?: SurveyStatus): Promise<Survey[]>;
export async function getSurvey(id: string): Promise<Survey>;
export async function updateSurvey(id: string, req: SurveyCreateRequest): Promise<Survey>;
export async function deleteSurvey(id: string): Promise<void>;
export async function createSegment(req: SegmentCreateRequest): Promise<Segment>;
export async function listSegments(): Promise<Segment[]>;
```

## 디스크 레이아웃

```
data/surveys/
├── {survey_id}/
│   ├── survey.json              # Survey 본체
│   └── sessions/
│       ├── {persona_uuid}.json  # ResponseSession 1건
│       └── ...
└── _index.json                  # 빠른 list_surveys용 메타 인덱스
data/segments/
├── {segment_id}.json
└── _index.json
```

## 검증

```bash
.venv/bin/python -c "from models.survey import Survey, Question, TargetFilter, ExecutionConfig, Answer, ResponseSession, Segment; print('OK')"
.venv/bin/python -c "from services.survey_repo import create_survey, get_survey; print('OK')"

# API 스모크 (create → get → list → delete)
curl -s -X POST http://localhost:5101/api/surveys -H "Content-Type: application/json" -d '{
  "title":"테스트 설문","objective":"음료 선호도",
  "target_filter":{"sample_size":50,"sampling":"random_n"},
  "execution":{"llm_provider":"anthropic","model":"claude-haiku-4-5","temperature":0.7,"include_reasoning":true},
  "questions":[{"order":1,"type":"single_choice","text":"커피 vs 차?","options":["커피","차"],"required":true}]
}' | jq '.id, .status'

curl -s http://localhost:5101/api/surveys | jq 'length'
```

## 완료 기준

- [ ] 5종 Pydantic 모델 import 무에러
- [ ] CRUD 9 엔드포인트(surveys 5 + segments 4 — list/create/get/update/delete) 200 응답
- [ ] 동일 survey_id에 동시 update 50회 호출해도 데이터 손상 없음 (atomic write 검증)
- [ ] master Phase 맵 상태 ⬜ → ✅
- [ ] 빌드 + pm2 restart 성공
