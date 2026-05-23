# Part 2: Analysis Core + API — Phase 2-3

> master: [../master.md](../master.md)
> 선행 Part: part1 | 후속 Part: part3
> 담당 Phase: 2-3 | 변경 파일: 약 7개 | 상태: 확정

## LLM 모델 매핑 (확정)

| 용도 | 모델 | 이유 |
|------|------|------|
| 소구점·타겟 특성 추출 | `claude-sonnet-4-6` | 구조화 JSON 추출 정확도 우선. tool_use 신뢰성 ↑ |
| 리포트 생성 (마크다운) | `claude-haiku-4-5` | 텍스트 생성 위주. 속도·비용 우선 (Sonnet 대비 ~3-5배 저렴) |
| 임베딩 | `openai/text-embedding-3-small` | 1536d, 저비용 |

## 목표 (필수)

- **Phase 2**: 상품설명서·약관 → Claude 소구점 추출 → 룰 필터 + pgvector 유사도 결합 반응도 스코어링 로직을 만든다.
- **Phase 3**: `POST /api/analyze` FastAPI 엔드포인트로 위 로직을 외부에 노출하고, Supabase `analyses` 테이블에 결과를 저장한다.

## 전제 조건 (필수 — 선행 Part 산출물)

- [ ] part1 완료 (Phase 0-1 검증 통과)
- [ ] Supabase `personas` 테이블에 10만 행 + `embedding` 채워짐
- [ ] `personas_embedding_ivf` 인덱스 존재 + 검색 < 500ms
- [ ] FastAPI `apps/api/main.py` 부팅 가능, `.env` 로드 정상
- [ ] 의존성 설치 완료: `anthropic`, `openai`, `supabase`, `tenacity`

## 작업 목록 (필수)

### Phase 2 — 분석 코어

- [ ] `apps/api/services/supabase_client.py` — 싱글톤 Supabase 클라이언트 (앱 수명주기)
- [ ] `apps/api/services/llm.py` — Claude·OpenAI 클라이언트 + 재시도
- [ ] `apps/api/prompts/selling_points.md` — 상품 → 소구점/타겟 특성 추출 프롬프트
- [ ] `apps/api/prompts/report.md` — 결과 → FP/기획자용 리포트 프롬프트
- [ ] `apps/api/services/scoring.py` — 룰 필터 + 임베딩 유사도 + 가중치 결합 + 지역 집계
- [ ] `apps/api/models/schemas.py` — 요청·응답 Pydantic 스키마

### Phase 3 — API 엔드포인트

- [ ] `apps/api/routes/analyze.py` — `POST /api/analyze` 핸들러
- [ ] `apps/api/main.py` — 라우터 등록, CORS(Next.js 로컬 허용), `/health`
- [ ] 응답 시간 측정 로그 (입력 임베딩 / 후보 select / 스코어링 / Claude 리포트 각 ms)
- [ ] `analyses` 테이블에 결과 저장
- [ ] 에러 응답 통일: 422(스키마 위반), 502(LLM 장애), 500(내부)

## 변경 예시 (필수, 핵심 시그니처만)

> 계획서는 청사진. 전체 구현 복붙 금지.

### `apps/api/models/schemas.py` — 신규

```python
from pydantic import BaseModel, Field

class AnalyzeRequest(BaseModel):
    product_text: str = Field(..., min_length=20, max_length=20000,
                              description="상품설명서 + 약관 본문")
    top_k: int = Field(20, ge=5, le=100)

class SellingPoints(BaseModel):
    """Claude가 추출한 상품 분석 결과."""
    summary: str                         # 한 줄 요약
    key_benefits: list[str]              # 핵심 혜택 3-5개
    target_age_min: int | None = None
    target_age_max: int | None = None
    target_sex: list[str] = []           # ["남자"] / ["여자"] / [] = 무관
    target_family_types: list[str] = []  # 우대 가구 유형
    target_keywords: list[str]           # 페르소나 매칭용 키워드 5-10개
    persona_category_weights: dict[str, float]  # travel/family/sports... 가중치 합 1.0

class PersonaHit(BaseModel):
    uuid: str
    score: float                  # 0-100
    persona: str
    province: str
    district: str
    sex: str
    age: int
    occupation: str

class RegionStat(BaseModel):
    name: str                     # province 또는 district
    count: int
    avg_score: float
    top_persona_uuid: str | None

class AnalyzeResponse(BaseModel):
    analysis_id: str
    selling_points: SellingPoints
    top_personas: list[PersonaHit]
    province_stats: list[RegionStat]
    district_stats: list[RegionStat]  # 상위 시도 1-3개의 시군구만
    report_md: str
    elapsed_ms: dict[str, int]    # {"embed": 312, "select": 1240, ...}
```

### `apps/api/services/llm.py` — 신규 (핵심 시그니처)

```python
from anthropic import Anthropic
from openai import OpenAI
from tenacity import retry, stop_after_attempt, wait_exponential

# 앱 수명주기 싱글톤
_anthropic: Anthropic | None = None
_openai: OpenAI | None = None

def anthropic_client() -> Anthropic: ...
def openai_client() -> OpenAI: ...

CLAUDE_SONNET = "claude-sonnet-4-6"
CLAUDE_HAIKU  = "claude-haiku-4-5"

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def extract_selling_points(product_text: str) -> SellingPoints:
    """Claude Sonnet으로 상품 분석 → SellingPoints 반환.

    - 모델: claude-sonnet-4-6 (구조화 추출 정확도 우선)
    - tool_use 모드로 SellingPoints 스키마 강제
    - product_text가 8000자 초과 시 앞 8000자로 truncate
    """
    ...

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def embed_text(text: str) -> list[float]:
    """OpenAI text-embedding-3-small 단건 임베딩."""
    ...

def generate_report(selling_points: SellingPoints,
                    top_personas: list[PersonaHit],
                    province_stats: list[RegionStat]) -> str:
    """Claude Haiku로 FP/기획자용 마크다운 리포트 생성.

    - 모델: claude-haiku-4-5 (속도·비용 우선, 텍스트 생성)
    - max_tokens 1500 상한 (리포트 길이 제어)
    """
    ...
```

### `apps/api/prompts/selling_points.md` — 신규 (요지)

```markdown
당신은 한국 보험·금융 상품의 타겟 마케팅 분석가입니다.

입력: 상품설명서와 약관 본문.

다음을 추출해 `record_selling_points` 도구로 호출하세요:
1. summary — 상품을 한 줄로 요약 (한국어)
2. key_benefits — 가입자가 얻는 핵심 혜택 3-5개
3. target_age_min / target_age_max — 명시되어 있거나 추론 가능하면, 불명확하면 null
4. target_sex — 성별 한정이 있으면 ["남자"] 또는 ["여자"], 아니면 []
5. target_family_types — 우대되는 가구 유형 (예: "배우자·자녀와 거주")
6. target_keywords — 페르소나 매칭에 쓸 5-10개 한국어 키워드 (관심사·라이프스타일)
7. persona_category_weights — 다음 6개 카테고리에 대한 가중치(합=1.0):
   professional, sports, arts, travel, culinary, family

규칙:
- 약관에 없는 속성은 절대 추측하지 마세요. 없으면 null/빈 배열.
- 키워드는 일반 명사로(고유명사 금지).
```

### `apps/api/services/scoring.py` — 신규 (핵심 알고리즘)

```python
from supabase import Client

# 단계별 후보 수 (조기 종료로 30초 내 달성)
PREFILTER_LIMIT = 5000   # 룰 필터 통과 후보
VECTOR_TOP_K    = 200    # pgvector 1차 후보
FINAL_TOP       = 20     # 최종 반환

def build_query_text(sp: SellingPoints) -> str:
    """soccer matching 텍스트 구성 (summary + benefits + keywords)."""
    return " ".join([sp.summary, *sp.key_benefits, *sp.target_keywords])

def prefilter_sql(sp: SellingPoints) -> str:
    """룰 필터 조건 (age, sex, family_type) 만 적용. 너무 좁아지면 조건 완화."""
    ...

def score_personas(sp: SellingPoints, query_emb: list[float],
                   client: Client) -> tuple[list[PersonaHit], list[RegionStat]]:
    """3단계 좁히기:
    1) 룰 사전필터 (SQL where)
    2) pgvector ivfflat 코사인 유사도 top VECTOR_TOP_K
    3) 가중치 결합 점수 = 0.7 * cosine + 0.2 * rule_bonus + 0.1 * category_weight
       → 0-100 정규화 → FINAL_TOP 반환
    + province/district 집계 (count, avg_score)
    """
    # 1) prefilter
    prefilter = prefilter_sql(sp)
    # 2) RPC 또는 SQL: select uuid, ..., (embedding <=> $1) as dist
    #    from personas where {prefilter} order by embedding <=> $1 limit 200
    # 3) Python에서 가중치 결합 + 카테고리 보너스 적용
    # 4) groupby province → RegionStat
    ...
```

### `apps/api/routes/analyze.py` — 신규

```python
from fastapi import APIRouter, HTTPException
from time import perf_counter

router = APIRouter(prefix="/api")

@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
    t = {}
    t0 = perf_counter()

    # 1) Claude 소구점 추출
    sp = extract_selling_points(req.product_text)
    t["selling_points"] = int((perf_counter() - t0) * 1000); t0 = perf_counter()

    # 2) query 텍스트 임베딩
    query_emb = embed_text(build_query_text(sp))
    t["embed"] = int((perf_counter() - t0) * 1000); t0 = perf_counter()

    # 3) 스코어링 + 지역 집계
    top, province_stats = score_personas(sp, query_emb, supabase_client())
    t["score"] = int((perf_counter() - t0) * 1000); t0 = perf_counter()

    # 4) district stats (상위 시도 1-3개만)
    district_stats = compute_district_stats(top, province_stats)

    # 5) Claude 리포트
    report = generate_report(sp, top, province_stats)
    t["report"] = int((perf_counter() - t0) * 1000)

    # 6) analyses 저장
    analysis_id = persist_analysis(req.product_text, sp, top,
                                   province_stats, district_stats, report)

    return AnalyzeResponse(
        analysis_id=analysis_id,
        selling_points=sp,
        top_personas=top[:req.top_k],
        province_stats=province_stats,
        district_stats=district_stats,
        report_md=report,
        elapsed_ms=t,
    )
```

### `apps/api/main.py` — 신규

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes.analyze import router as analyze_router

app = FastAPI(title="PersonaFit API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # 배포 시 환경변수로 분리
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

@app.get("/health")
def health(): return {"ok": True}

app.include_router(analyze_router)
```

## 검증 (필수)

```bash
# 1) 단위: 임포트 + Pydantic 스키마
cd apps/api && uv run python -c "from models.schemas import AnalyzeRequest; print('ok')"

# 2) 통합: 샘플 약관으로 분석
uv run uvicorn main:app --reload &
curl -X POST http://localhost:8000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"product_text": "보장 기간 80세 만기, 어린이 의료비 특약 포함, ..."}'

# 응답 확인
# - HTTP 200
# - elapsed_ms.total < 30000
# - top_personas 길이 == 20
# - province_stats 길이 <= 17
# - report_md 비어있지 않음

# 3) 이력 저장 확인
# Supabase SQL: select count(*), max(created_at) from analyses;
```

### 성능 게이트

| 단계 | 목표 ms | 한계 ms | 초과 시 대응 |
|------|--------:|--------:|-------------|
| `selling_points` (Sonnet) | 3000 | 6000 | 프롬프트 길이 축소, max_tokens 축소 |
| `embed` (OpenAI) | 500 | 1500 | 캐싱 (동일 입력 재사용) |
| `score` (Supabase + Python) | 1500 | 3000 | `ivfflat probes` 튜닝, prefilter 강화 |
| `report` (Haiku) | 2500 | 6000 | max_tokens 1500 상한, top_personas 길이 축소 |
| **합계** | **7500** | **16500** | 30s 목표 대비 충분한 마진 (Haiku 적용으로 단축) |

## 완료 기준 (필수 — 다음 Part로 진행 전)

- [ ] 모든 작업 목록 완료
- [ ] 샘플 약관 1건 분석이 30초 내 200 OK + 스키마 일치
- [ ] `analyses` 테이블에 분석 이력 1건 저장됨
- [ ] 에러 케이스 3종 점검: 빈 입력(422), 잘못된 키(502), 정상(200)
- [ ] master의 Phase 맵에서 Phase 2, 3 상태를 ✅로 갱신
- [ ] 후속 Part(part3)의 전제 조건 충족: `POST /api/analyze`가 안정적으로 응답, 응답 스키마 확정
