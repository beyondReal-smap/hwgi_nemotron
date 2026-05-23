# Part 1: Foundation — Phase 0-1

> master: [../master.md](../master.md)
> 선행 Part: - | 후속 Part: part2
> 담당 Phase: 0-1 | 변경 파일: 약 10개 | 상태: 초안

## 목표 (필수)

- **Phase 0**: pnpm workspace 기반 모노레포(`apps/web`, `apps/api`, `scripts/`, `supabase/`)를 구성하고 환경변수·의존성을 가동 가능 상태로 만든다. ✅ **완료 (2026-05-20)**
- **Phase 1**: Nemotron-Personas-Korea 100만 행에서 **10만 행 stratified 샘플링** → `data/personas_100k.parquet` 저장 → OpenAI 임베딩 생성 → `data/embeddings_100k.npy`(numpy float32) 저장. **DB는 사용하지 않음 (Phase 5에서 Supabase 업로드)**.

> **하이브리드 전략 (확정)**:
> - 개발·데모: **로컬 parquet + numpy 매트릭스** (인메모리 코사인 검색)
> - 제출용 100만 행 임베딩: Phase 5에서 별도 batch 실행 → GitHub Release

## 전제 조건 (필수 — 선행 Part 산출물)

- [ ] Supabase 프로젝트 생성됨 (URL · service role key 확보)
- [ ] HuggingFace 데이터셋 접근 가능 (탐색 단계에서 검증 완료)
- [ ] API 키: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 확보
- [ ] 로컬 Python 3.12 + `uv` + Node 20 + pnpm 사용 가능 (탐색 단계에서 확인)

## 작업 목록 (필수)

### Phase 0 — 환경 구축

- [ ] 루트 `package.json`, `pnpm-workspace.yaml` 생성 (workspace: `apps/*`)
- [ ] `apps/web` Next.js 14 App Router + Tailwind + TypeScript 스캐폴딩 (`pnpm create next-app`)
- [ ] `apps/api` FastAPI + uv 프로젝트 초기화 (`uv init --package`)
- [ ] `.env.example` 작성 (필요 키 6종)
- [ ] `supabase/` 디렉토리 + 첫 마이그레이션 파일 위치 확보
- [ ] Supabase 프로젝트에서 `pgvector` extension 활성화 확인
- [ ] `.gitignore` (Python venv, node_modules, .env, 파케이 캐시 등)

### Phase 1 — 데이터 적재 + 임베딩 (로컬 parquet/numpy)

- [ ] `scripts/sample_personas.py` — 10만 행 stratified 샘플링 → `data/personas_100k.parquet`
- [ ] `scripts/embed_personas.py` — `persona` 텍스트 임베딩 batch → `data/embeddings_100k.npy` (float32, shape (100000, 1536))
- [ ] `data/personas_100k.parquet` 행 수 = 100000 검증
- [ ] `data/embeddings_100k.npy` shape == (100000, 1536) 검증
- [ ] `supabase/migrations/0001_personas.sql` — 테이블 스키마 작성 (실행은 Phase 5에서)
- [ ] `supabase/migrations/0002_analyses.sql` — 분석 이력 테이블 스키마 (실행은 Phase 5에서)

## 변경 예시 (필수, 핵심 시그니처만)

> 계획서는 청사진. 전체 구현 복붙 금지.

### `pnpm-workspace.yaml` — 신규

```yaml
packages:
  - "apps/*"
```

### `apps/api/pyproject.toml` — 신규 (핵심 의존성만)

```toml
[project]
name = "personafit-api"
requires-python = ">=3.12"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.30",
  "pydantic>=2.9",
  "anthropic>=0.40",
  "openai>=1.50",
  "supabase>=2.8",
  "datasets>=4.0",       # 적재 스크립트
  "pyarrow>=17",
  "tenacity>=9.0",       # 재시도
  "python-dotenv>=1.0",
]
```

### `.env.example` — 신규

```bash
# Anthropic / OpenAI
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
SUPABASE_ANON_KEY=eyJhbGc...

# 프론트 → 백 (Next.js public)
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

### `supabase/migrations/0001_personas.sql` — 신규

```sql
create extension if not exists vector;

create table personas (
  uuid                       text primary key,
  -- 페르소나 텍스트 (검색 대상)
  persona                    text not null,
  professional_persona       text,
  sports_persona             text,
  arts_persona               text,
  travel_persona             text,
  culinary_persona           text,
  family_persona             text,
  -- 보조 텍스트
  skills_and_expertise       text,
  hobbies_and_interests      text,
  career_goals_and_ambitions text,
  -- 인구통계
  sex                        text not null,
  age                        int  not null,
  marital_status             text,
  military_status            text,
  family_type                text,
  housing_type               text,
  education_level            text,
  bachelors_field            text,
  occupation                 text,
  -- 지역
  province                   text not null,
  district                   text not null,
  -- 임베딩 (persona 종합 텍스트 기준 1536차원, text-embedding-3-small)
  embedding                  vector(1536),
  -- 보조 임베딩 (카테고리별, MVP에서는 우선 persona만)
  travel_emb                 vector(1536),
  family_emb                 vector(1536),
  inserted_at                timestamptz default now()
);

create index personas_province_idx on personas (province);
create index personas_age_idx      on personas (age);
create index personas_sex_idx      on personas (sex);
-- 임베딩 인덱스는 데이터 적재 후 생성 (build cost ↓):
--   create index personas_embedding_ivf on personas
--   using ivfflat (embedding vector_cosine_ops) with (lists = 100);
```

### `supabase/migrations/0002_analyses.sql` — 신규

```sql
create table analyses (
  id            uuid primary key default gen_random_uuid(),
  product_text  text not null,            -- 상품설명서 + 약관
  selling_points jsonb not null,          -- Claude 추출 결과
  target_filter jsonb not null,           -- 룰 필터 조건
  top_personas  jsonb not null,           -- 상위 N명 (uuid + score)
  region_stats  jsonb not null,           -- 시도/시군구 집계
  report_md     text  not null,           -- Claude 리포트 마크다운
  created_at    timestamptz default now()
);

create index analyses_created_at_idx on analyses (created_at desc);
```

### `scripts/sample_personas.py` — 신규 (핵심 시그니처)

```python
"""10만 행 stratified 샘플링 → data/personas_100k.parquet.

전략: province(17) × age_bucket(8개: 10대-80대) × sex(2) ≈ 272 셀
셀당 비례 할당. 모자란 셀은 가용 전체. 부족분은 무작위 보충.
DB 사용 안 함. 다음 단계(embed_personas.py)가 동일 parquet을 읽어 임베딩 채움.
"""
from __future__ import annotations
import pandas as pd
from datasets import load_dataset

DATASET_ID = "nvidia/Nemotron-Personas-Korea"
TARGET_TOTAL = 100_000
OUTPUT_PATH = "data/personas_100k.parquet"
SEED = 42

AGE_BUCKETS = [(0,19),(20,29),(30,39),(40,49),(50,59),(60,69),(70,79),(80,999)]

# 저장할 컬럼만 선택 (불필요한 텍스트 제외 가능하나 MVP는 전체 보존)
KEEP_COLS = ["uuid", "persona", "professional_persona", "sports_persona",
             "arts_persona", "travel_persona", "culinary_persona", "family_persona",
             "skills_and_expertise", "hobbies_and_interests",
             "career_goals_and_ambitions",
             "sex", "age", "marital_status", "military_status", "family_type",
             "housing_type", "education_level", "bachelors_field", "occupation",
             "district", "province"]

def age_bucket(age: int) -> str: ...

def stratified_sample(df: pd.DataFrame, target: int) -> pd.DataFrame:
    """province × age_bucket × sex 비례 stratified sampling.
    pandas groupby + sample(frac=target/N).
    """
    ...

def main() -> None:
    ds = load_dataset(DATASET_ID, split="train")
    df = ds.to_pandas()[KEEP_COLS]
    sampled = stratified_sample(df, TARGET_TOTAL)
    sampled.to_parquet(OUTPUT_PATH, index=False, compression="zstd")
    print(f"✅ {len(sampled)}행 저장: {OUTPUT_PATH}")
```

### `scripts/embed_personas.py` — 신규 (핵심 시그니처)

```python
"""data/personas_100k.parquet → data/embeddings_100k.npy.

진행 전략:
- 입력: data/personas_100k.parquet (Phase 1A 결과)
- 출력: data/embeddings_100k.npy (np.float32, shape (100000, 1536))
- 검색은 우리가 npy를 메모리 로드 + numpy 코사인 유사도 = 매우 빠름 (10만 행 < 50ms)
- 진행률 체크포인트: 매 10000건마다 npy 저장 (중단 시 재시작 가능)
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from openai import OpenAI
from tenacity import retry, stop_after_attempt, wait_exponential

BATCH = 100
MODEL = "text-embedding-3-small"
DIM = 1536
INPUT_PATH = "data/personas_100k.parquet"
OUTPUT_PATH = "data/embeddings_100k.npy"
CHECKPOINT_EVERY = 10_000  # 10000건마다 저장

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=10))
def embed_batch(client: OpenAI, texts: list[str]) -> list[list[float]]:
    res = client.embeddings.create(model=MODEL, input=texts)
    return [d.embedding for d in res.data]

def main() -> None:
    df = pd.read_parquet(INPUT_PATH)
    n = len(df)
    embeddings = np.zeros((n, DIM), dtype=np.float32)

    # 체크포인트 복구 (있으면 거기서부터)
    start = resume_from_checkpoint(embeddings, OUTPUT_PATH)

    client = OpenAI()
    for i in range(start, n, BATCH):
        texts = df["persona"].iloc[i:i+BATCH].tolist()
        vecs = embed_batch(client, texts)
        embeddings[i:i+BATCH] = vecs
        if (i + BATCH) % CHECKPOINT_EVERY == 0:
            np.save(OUTPUT_PATH, embeddings)
            print(f"  진행: {i+BATCH}/{n}")
    np.save(OUTPUT_PATH, embeddings)
    print(f"✅ shape={embeddings.shape} 저장: {OUTPUT_PATH}")
```

> **비용**: 10만 행 × ~80자 평균 × ~1.5토큰/자 ≈ 12M 토큰 × $0.02/1M = **약 $0.24**
> **시간**: 1000 배치 × 1-2초/배치 ≈ **15-30분**

## 검증 (필수)

```bash
# Phase 0 ✅ (완료)
pnpm install                                          # → 366 packages installed
pnpm --filter web dev                                 # → HTTP 200 (2.5s)
cd apps/api && uv sync && uv run uvicorn main:app    # → /health 200 OK

# Phase 1
mkdir -p data
python scripts/sample_personas.py                     # → data/personas_100k.parquet
python scripts/embed_personas.py                      # → data/embeddings_100k.npy (15-30분, ~$0.24)

# 검증 (Python REPL 또는 빠른 스크립트)
python -c "import pandas as pd, numpy as np; \
  df = pd.read_parquet('data/personas_100k.parquet'); \
  emb = np.load('data/embeddings_100k.npy'); \
  print(f'rows={len(df)}, emb.shape={emb.shape}'); \
  print(df['province'].value_counts().head())"
```

기대 출력:
- `rows=100000, emb.shape=(100000, 1536)`
- 17개 province가 모두 표시 (실제 인구 비례)

## 완료 기준 (필수 — 다음 Part로 진행 전)

- [ ] 모든 작업 목록 완료
- [ ] `data/personas_100k.parquet` 행 수 == 100000
- [ ] `data/embeddings_100k.npy` shape == (100000, 1536), dtype == float32
- [ ] 17개 province 모두 샘플에 포함
- [ ] `.env`가 git에 커밋되지 않음 (`.env.example`만 트래킹)
- [ ] master의 Phase 맵에서 Phase 0, 1 상태를 ✅로 갱신
- [ ] 후속 Part(part2)의 전제 조건 충족: `data/personas_100k.parquet` + `data/embeddings_100k.npy` 로드 가능
