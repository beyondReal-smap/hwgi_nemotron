# Part 4: 응답 생성 엔진·캐싱·재시도 — Phase 4

> master: [../master.md](../master.md)
> 선행 Part: part3 | 후속 Part: part5
> 담당 Phase: 4 | 변경 파일: 5개 | 상태: 초안

## 목표

- `POST /api/surveys/:id/run` 호출 시 백그라운드 태스크로 (page 페르소나 × 모든 질문) LLM 호출 → 답변·근거·확신도 추출 → `ResponseSession` upsert. 동시성 제한·캐싱·지수 백오프 재시도 포함.

## 전제 조건

- [ ] part2 `Survey`/`ResponseSession`/`Answer` 모델 및 `survey_repo.upsert_session` 동작
- [ ] part2의 `survey.persona_uuids[]` 채워져 있음 (마법사 Step 2에서 확정)
- [ ] 기존 `apps/api/services/llm.py`의 `call_anthropic_tool` / `call_sllm_tool` 패턴 숙지

## 작업 목록

- [ ] `services/answer_cache.py` — 캐시 키 + 파일 기반 저장 (data/answer_cache/{sha256}.json)
- [ ] `services/survey_engine.py` — 단일 (persona, question) → Answer 생성 함수
- [ ] `services/survey_run.py` — 배치 실행자 (asyncio.gather + semaphore + 재시도)
- [ ] `services/llm.py` — `generate_persona_answer(...)` 함수 추가 (tool_use 스키마 강제)
- [ ] `routes/survey_run.py` — `POST /api/surveys/:id/run` + BackgroundTasks 트리거

## 변경 예시 (핵심 시그니처만)

**`apps/api/services/answer_cache.py` — 신규**
```python
import hashlib, json
from pathlib import Path
from models.survey import Answer

BASE = Path("data/answer_cache")

def cache_key(persona_uuid: str, question_id: str, model: str, temperature: float) -> str:
    """동일 (persona+question+model+temp) 조합은 동일 키."""
    raw = f"{persona_uuid}|{question_id}|{model}|{round(temperature, 2)}"
    return hashlib.sha256(raw.encode()).hexdigest()

def get(key: str) -> Answer | None: ...
def put(key: str, answer: Answer) -> None: ...
def invalidate(prefix: str = "") -> int: ...   # 강제 재생성용 (선택)
```

**`apps/api/services/survey_engine.py` — 신규**
```python
from models.survey import Question, Answer
from services import answer_cache
from services.llm import generate_persona_answer
from services.store import get_store

async def answer_one(
    persona_uuid: str,
    question: Question,
    provider: str,
    model: str,
    temperature: float,
    include_reasoning: bool,
) -> tuple[Answer, int]:
    """단일 페르소나 × 단일 질문 → Answer + token_used.

    1) 캐시 확인
    2) 캐시 미스 → store.get_row(persona_uuid)로 프로필 텍스트 추출
    3) LLM 호출 (tool_use로 answer/reasoning/confidence 스키마 강제)
    4) Answer 객체 반환 + 캐시 저장
    """
    key = answer_cache.cache_key(persona_uuid, question.id, model, temperature)
    cached = answer_cache.get(key)
    if cached is not None:
        return cached, 0

    store = get_store()
    row = store.df.loc[store.df["uuid"] == persona_uuid].iloc[0]
    profile = _build_profile(row)         # persona 텍스트 + 인구통계 요약

    answer, tokens = await generate_persona_answer(
        profile=profile,
        question=question,
        provider=provider,
        model=model,
        temperature=temperature,
        include_reasoning=include_reasoning,
    )
    answer_cache.put(key, answer)
    return answer, tokens
```

**`apps/api/services/llm.py` — 수정**
```python
# 신규 함수 추가. 기존 함수는 그대로 유지.

ANSWER_PROMPT = """당신은 다음과 같은 페르소나입니다:
{profile}

위 페르소나의 입장에서, 일관된 가치관·말투·소비성향을 유지하며 아래 질문에 답해주세요.

[설문 맥락]
{survey_objective}

[질문]
{question_text}

[선택지] (객관식인 경우)
{options_block}

답변 형식:
- answer: ({answer_format})
- reasoning: (50자 이내, 이 페르소나가 그렇게 답한 이유)
- confidence: (0.0~1.0, 답변에 대한 확신도)
"""

# tool_use 스키마
ANSWER_TOOL_SCHEMA = {
  "name": "submit_answer",
  "input_schema": {
    "type": "object",
    "properties": {
      "answer": {"type": ["string", "integer", "array"]},
      "reasoning": {"type": "string", "maxLength": 80},
      "confidence": {"type": "number", "minimum": 0, "maximum": 1},
    },
    "required": ["answer", "reasoning", "confidence"],
  },
}

async def generate_persona_answer(
    profile: str,
    question: Question,
    provider: str,
    model: str,
    temperature: float,
    include_reasoning: bool,
) -> tuple[Answer, int]:
    """tool_use 모드로 LLM 호출 → Answer + token_used 반환."""
    # provider 분기: anthropic / sllm
    # answer_format은 question.type에 따라 결정:
    #   single_choice → "선택지 번호 (1-N)"
    #   multi_choice → "선택지 번호 배열"
    #   scale → f"{scale_min}-{scale_max} 정수"
    #   open_ended → "자유 텍스트 (200자 이내)"
    #   nps → "0-10 정수"
```

**`apps/api/services/survey_run.py` — 신규**
```python
import asyncio
from datetime import datetime
from models.survey import Survey, ResponseSession
from services import survey_repo
from services.survey_engine import answer_one

CONCURRENCY = 8                              # 동시 LLM 호출 상한
MAX_RETRIES = 3
BACKOFF_BASE = 1.0                           # 지수 백오프: 1s, 2s, 4s

async def run_survey(survey: Survey) -> None:
    """survey.persona_uuids × survey.questions LLM 호출 → sessions upsert."""
    semaphore = asyncio.Semaphore(CONCURRENCY)

    async def run_one_persona(persona_uuid: str) -> None:
        session = ResponseSession(
            id=f"{survey.id}:{persona_uuid}",
            survey_id=survey.id,
            persona_uuid=persona_uuid,
            status="running",
            started_at=datetime.utcnow(),
            llm_model_used=survey.execution.model,
        )
        survey_repo.upsert_session(session)

        try:
            answers = []
            total_tokens = 0
            for q in survey.questions:
                async with semaphore:
                    answer, tokens = await _retry(
                        lambda: answer_one(persona_uuid, q, survey.execution.llm_provider,
                                           survey.execution.model, survey.execution.temperature,
                                           survey.execution.include_reasoning),
                    )
                    answers.append(answer)
                    total_tokens += tokens

            session.answers = answers
            session.status = "completed"
            session.completed_at = datetime.utcnow()
            session.total_tokens = total_tokens
        except Exception as e:
            session.status = "failed"
            session.error = str(e)[:200]
            session.completed_at = datetime.utcnow()
        finally:
            survey_repo.upsert_session(session)

    # survey 상태 running으로 갱신
    survey.status = "running"
    survey_repo.update_survey(survey)

    await asyncio.gather(*[run_one_persona(uuid) for uuid in survey.persona_uuids])

    # 완료 후 상태 갱신
    counts = survey_repo.count_sessions(survey.id)
    survey.status = "completed" if counts.get("failed", 0) == 0 else "failed"
    survey_repo.update_survey(survey)

async def _retry(fn, max_retries: int = MAX_RETRIES) -> any:
    """지수 백오프 재시도. 마지막 실패는 raise."""
    for attempt in range(max_retries):
        try:
            return await fn()
        except Exception:
            if attempt == max_retries - 1:
                raise
            await asyncio.sleep(BACKOFF_BASE * (2 ** attempt))
```

**`apps/api/routes/survey_run.py` — 신규**
```python
from fastapi import APIRouter, BackgroundTasks, HTTPException
from services import survey_repo
from services.survey_run import run_survey

router = APIRouter(prefix="/api/surveys", tags=["survey_run"])

@router.post("/{survey_id}/run", status_code=202)
def trigger_run(survey_id: str, bg: BackgroundTasks) -> dict:
    """드래프트 설문 시뮬레이션 시작 (백그라운드)."""
    survey = survey_repo.get_survey(survey_id)
    if survey is None:
        raise HTTPException(404, "survey not found")
    if survey.status not in ("draft", "failed"):
        raise HTTPException(409, f"이미 {survey.status} 상태입니다")
    if not survey.persona_uuids:
        raise HTTPException(400, "대상 페르소나가 비어 있습니다")

    # 빈 세션부터 미리 생성 (진행률 표시용)
    for uuid in survey.persona_uuids:
        if not survey_repo.session_exists(survey.id, uuid):
            survey_repo.upsert_session(ResponseSession(
                id=f"{survey.id}:{uuid}", survey_id=survey.id, persona_uuid=uuid,
                status="pending",
            ))

    bg.add_task(asyncio.run, run_survey(survey))
    return {"status": "started", "survey_id": survey.id, "total": len(survey.persona_uuids)}
```

## 캐싱 키 설계

- `sha256(persona_uuid + "|" + question_id + "|" + model + "|" + round(temperature, 2))`
- 동일 설문 재실행 또는 다른 설문에서 동일 질문 재사용 시 모두 hit
- temperature 0.7 → 0.71 변경은 같은 키(반올림) — 의도된 노이즈 허용
- 강제 재생성은 `invalidate(prefix)` 또는 디스크에서 파일 삭제

## 에러 처리 정책

| 케이스 | 동작 |
|---|---|
| LLM API 일시 오류 (429, 503) | 지수 백오프 최대 3회 재시도, 실패 시 session.status=failed |
| 스키마 미준수 응답 | tool_use 강제 + 파싱 실패 시 1회 재시도 후 partial 저장 (reasoning=빈 문자열, confidence=0) |
| 페르소나 데이터 누락 | 즉시 실패 — store에 없는 uuid면 session.error="persona not found" |
| 동시 실행 중복 | survey.status != "draft"이면 409 |

## 검증

```bash
.venv/bin/python -c "from services.survey_engine import answer_one; from services.answer_cache import cache_key; print('OK')"

# 작은 설문(2 페르소나 × 1 질문)으로 스모크
curl -s -X POST http://localhost:5101/api/surveys/{small_survey_id}/run | jq
# 1초 후
curl -s http://localhost:5101/api/surveys/{small_survey_id} | jq '.status'
# 캐시 동작
ls data/answer_cache/ | wc -l   # 첫 실행 후 = 2개
# 동일 설문 재실행 → 캐시 hit → 로그상 LLM 호출 0회
```

## 완료 기준

- [ ] 작은 설문(10 × 3 = 30 호출) end-to-end 성공
- [ ] 캐시 재실행 시 LLM 호출 0회 확인 (로그 또는 token=0)
- [ ] 인위적 429 주입 시 재시도 후 성공/실패 분기 동작
- [ ] tool_use 스키마 강제로 answer/reasoning/confidence 모두 채워짐
- [ ] master Phase 맵 상태 ⬜ → ✅
- [ ] 빌드 + pm2 restart 성공
