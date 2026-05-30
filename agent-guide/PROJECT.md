---
name: project
description: PersonaFit 프로젝트 핵심 요약. 프로젝트 구조와 기술 스택 파악용.
last-updated: 2026-05-25
---

# 프로젝트 개요

> **PersonaFit** — 상품설명서·약관·마케팅 카피·신상품 컨셉을 입력하면 100만 행 합성 한국인 페르소나(Nemotron-Personas-Korea)와 매칭해 반응할 타겟·반응도·공략 지역·페르소나 의견·FP 판매 전략·A/B 비교·가상 설문 응답까지 제공하는 상품 기획·마케팅 분석 도구.

---

## TL;DR

| 항목 | 내용 |
|------|------|
| **프로젝트** | PersonaFit |
| **데이터** | 100만 행 `nvidia/Nemotron-Personas-Korea` (CC BY 4.0) — 인메모리 (parquet 930MB + npy 5.8GB mmap) |
| **프론트엔드** | Next.js 14 App Router + Tailwind (한화 톤 — vellum/ink/onyx/graphite/dusty/stone/parchment/snow/azure/terra) + SUITE Variable 폰트 |
| **백엔드** | FastAPI + uv (Python 3.12) |
| **LLM** | **sLLM (vLLM Qwen3.6-27B-FP8, OpenAI 호환) 단일 호출.** Anthropic Claude SDK 코드는 향후 복귀를 위해 보존하되 호출 차단 (각 함수 진입부 `provider = "sllm"` 강제) |
| **임베딩** | OpenAI `text-embedding-3-small` (1536d) + 2계층 캐시 (메모리 LRU + 디스크 .npy) |
| **검색** | brute-force (100만 행 ~84ms) — HNSW 미사용 (모집단 cohort 통계 필요) |
| **핵심 기능** | 약관 분석 · A/B 테스트 · 페르소나 탐색 · 설문 마법사 · 시뮬레이션 · 이력 · 세그먼트 · 현황 대시보드 |
| **운영** | pm2 (`personafit-web` 5101 외부 / `personafit-api` 5102 내부, FastAPI는 Next.js rewrites 프록시) |

---

## 핵심 기능 (9개)

| # | 페이지 | 기능 |
|---|--------|------|
| 1 | `/` (분석) | 상품설명서·약관 → 소구점 추출 → 페르소나 매칭 → 인메모리 100만 행 cohort 통계 → 페르소나 의견 + FP 리포트 |
| 2 | `/abtest` | 두 안(약관·카피·컨셉) 평행 분석 + 비교 표 + 추천안 + 당사 관점 장단점 + FP 판매 전략 |
| 3 | `/personas` | 자연어 페르소나 검색 (시멘틱 + 메타 필터 자동 추출) + 카드 그리드 + 상세 모달 + 세그먼트 저장 |
| 4 | `/surveys` | 설문 마법사(StepBasic→Targets→Questions→Execution) + 진행 모니터 + 응답 통계 + 차트 리포트 |
| 5 | `/overview` | 데이터셋 전체 통계 시각화 (분포·집계) |
| 6 | `/history` | 과거 분석 이력 다시 보기 |
| 7 | `/abtest?mode=history` | A/B 테스트 이력 |
| 8 | 시뮬레이션 | 페르소나 가상 응답 — 분석 결과 페이지 내 호출 |
| 9 | 파일 업로드 | TXT · PDF · DOCX · HWP · HWPX 자동 텍스트 추출 (InputForm + ABTestInputForm 공통) |

---

## 프로젝트 구조

```
ai_hack/
├── ecosystem.config.cjs              # pm2 진입점 (personafit-web 5101 / personafit-api 5102)
├── pnpm-workspace.yaml               # apps/web 워크스페이스
├── .env.example                      # ANTHROPIC/OPENAI/SLLM_* 환경변수 템플릿
├── agent-guide/                      # AI 에이전트 가이드 문서
│   ├── GUIDE.md
│   ├── PROJECT.md                    # ← 이 파일
│   ├── SESSION.md
│   └── plans/
├── apps/
│   ├── web/                          # Next.js 14 App Router + Tailwind
│   │   ├── app/
│   │   │   ├── page.tsx              # / 분석 (InputForm + ScoreCard + PersonaList + KoreaMap + ReportPanel)
│   │   │   ├── abtest/               # /abtest A/B 테스트
│   │   │   ├── personas/             # /personas 자연어 탐색
│   │   │   ├── surveys/              # /surveys 설문 마법사 + 이력
│   │   │   │   ├── new/              #   /surveys/new 새 설문 작성
│   │   │   │   └── [id]/             #   /surveys/[id]/{progress,responses,report}
│   │   │   ├── survey/[analysisId]/  # /survey/[id] 분석에서 시작한 가상 설문
│   │   │   ├── overview/             # /overview 데이터셋 통계
│   │   │   ├── history/              # /history 분석 이력
│   │   │   ├── fonts/                # SUITE Variable 폰트 import
│   │   │   ├── globals.css
│   │   │   └── layout.tsx
│   │   ├── components/               # 27개 + abtest/ 4개 + wizard/ 8개
│   │   │   ├── SiteHeader.tsx        # sticky 헤더 + nav (현황/탐색/분석/A·B/설문)
│   │   │   ├── InputForm.tsx         # 분석 입력 (텍스트 + 파일 업로드 + 모드 선택)
│   │   │   ├── ScoreCard.tsx         # 분석 상단 KPI 카드
│   │   │   ├── PersonaList.tsx       # 상·하위 페르소나 카드
│   │   │   ├── PersonaCardGrid.tsx   # /personas 카드 그리드
│   │   │   ├── PersonaDetailModal.tsx
│   │   │   ├── PersonaFilterPanel.tsx
│   │   │   ├── PopulationStatsPanel.tsx
│   │   │   ├── KoreaMap.tsx          # 시군구 choropleth
│   │   │   ├── DistrictTopTable.tsx
│   │   │   ├── RegionChart.tsx
│   │   │   ├── ReportPanel.tsx       # 마크다운 리포트
│   │   │   ├── ReportChartChoice.tsx / ReportChartScale.tsx / ReportOpenEnded.tsx
│   │   │   ├── SurveyPanel.tsx / SurveyHistoryList.tsx / SurveyProgress.tsx
│   │   │   ├── ResponsesByPersona.tsx / ResponsesByQuestion.tsx
│   │   │   ├── PastSimulationsPanel.tsx
│   │   │   ├── HistoryList.tsx
│   │   │   ├── LLMProviderToggle.tsx # Anthropic/sLLM 토글
│   │   │   ├── SaveSegmentModal.tsx / ConfirmModal.tsx / AlertModal.tsx
│   │   │   ├── AnalysisProgress.tsx
│   │   │   ├── abtest/               # ABTestInputForm/ResultPanel/HistoryList/ComparisonTable
│   │   │   └── wizard/               # StepBasic/Targets/Questions/Execution + WizardShell/Container
│   │   ├── lib/api.ts                # 백엔드 호출 + 타입
│   │   ├── tailwind.config.ts        # 한화 톤 10개 토큰
│   │   ├── next.config.mjs           # API rewrites (/api/* → 127.0.0.1:5102)
│   │   └── package.json
│   └── api/                          # FastAPI + uv (Python 3.12)
│       ├── main.py                   # 진입점 + 라우터 등록
│       ├── routes/                   # 14개 라우트
│       │   ├── analyze.py            #   POST /api/analyze
│       │   ├── analyses.py           #   GET  /api/analyses (이력)
│       │   ├── abtest.py / abtests.py#   /api/abtest (실행) / /api/abtests (목록·삭제)
│       │   ├── dataset.py            #   /api/dataset/personas/{search,filter,facets,samples,overview}
│       │   ├── extract.py            #   POST /api/extract (파일 → 텍스트)
│       │   ├── segments.py           #   세그먼트 CRUD
│       │   ├── simulate.py           #   페르소나 가상 응답
│       │   ├── surveys.py / survey_*  #   설문 6개 (생성/실행/진행/응답/리포트/import)
│       ├── services/                 # 21개 서비스
│       │   ├── store.py              #   PersonaStore 싱글톤 (mmap_mode="r", category dtype 최적화)
│       │   ├── llm.py                #   Anthropic/sLLM 추상화, embed_text + per-key lock
│       │   ├── embed_cache.py        #   2계층 임베딩 캐시 (메모리 LRU 4096 + 디스크 .npy)
│       │   ├── answer_cache.py       #   페르소나 응답 캐시 (persona×question×model×temp)
│       │   ├── scoring.py            #   분석 스코어링 + cohort 통계
│       │   ├── persona_search.py     #   자연어 시멘틱 검색
│       │   ├── dataset_stats.py      #   /overview용 통계 집계
│       │   ├── opinions.py           #   페르소나 의견 LLM 생성
│       │   ├── abtest_llm.py / abtest_persistence.py / comparison.py  # A/B 테스트
│       │   ├── survey_engine.py / survey_repo.py / survey_run.py     # 설문 실행·저장
│       │   ├── question_parser.py    #   설문 질문 import 파싱
│       │   ├── simulation.py         #   시뮬레이션 LLM 호출
│       │   ├── segment_repo.py       #   세그먼트 영속화
│       │   ├── persistence.py        #   분석 결과 영속화 (analyses.jsonl)
│       │   ├── commentary.py         #   설문 차트 리포트 총평
│       │   └── text_extractor.py     #   TXT/PDF/DOCX/HWP/HWPX 추출
│       ├── prompts/                  # 7개 LLM 시스템 프롬프트
│       │   ├── selling_points.md / report.md / commentary.md
│       │   ├── persona_opinion.md / survey_response.md
│       │   └── abtest_company.md / abtest_strategy.md
│       ├── models/
│       │   ├── schemas.py            #   Pydantic 응답 스키마 (Persona/Cohort/...)
│       │   └── survey.py             #   설문 도메인 모델
│       ├── pyproject.toml
│       └── .venv/                    # uv 가상환경
├── data/                             # 운영 데이터 (git 제외)
│   ├── personas_1m.parquet           #   930MB — 100만 행 메타
│   ├── embeddings_1m_v2.npy          #   5.8GB — 통합 임베딩 v2 (운영)
│   ├── personas_100k.parquet / embeddings_100k.npy  #   개발용 샘플
│   ├── analyses.jsonl                #   분석 이력
│   ├── abtests.jsonl                 #   A/B 테스트 이력
│   ├── simulations.jsonl             #   시뮬레이션 결과
│   ├── surveys/                      #   설문 정의·진행·응답
│   ├── segments/                     #   사용자 세그먼트
│   ├── answer_cache/                 #   페르소나 응답 캐시 (sha256 샤딩)
│   ├── embed_cache/                  #   임베딩 캐시 (sha256 샤딩, .npy)
│   └── .archive/2026-05-22_v1-npy/   #   v1 임베딩 5.8GB 롤백 보존
├── scripts/
│   ├── sample_personas.py            #   100만 행 stratified 샘플링
│   ├── embed_personas.py             #   OpenAI batch 임베딩
│   ├── embed_categories_100k.py      #   카테고리별 임베딩
│   ├── dump_personas_full.py
│   ├── backfill_commentaries.py      #   설문 리포트 총평 backfill
│   ├── validate_known_targets.py     #   알려진 타겟 검증
│   └── explore_personas.py           #   데이터셋 탐색
```

---

## 기술 스택

| 영역 | 기술 | 비고 |
|------|------|------|
| **프론트엔드** | Next.js 14 (App Router) + Tailwind | 한화 톤 10개 토큰만 사용. SUITE Variable 본문 폰트 |
| **백엔드** | FastAPI + uv (Python 3.12) | uvicorn workers=1, timeout-keep-alive 300s |
| **LLM** | sLLM (vLLM Qwen3.6-27B-FP8, OpenAI 호환) — `DEFAULT_PROVIDER=sllm` 단일 호출 | Anthropic 호출 비활성 (SDK·구현체 보존) |
| **임베딩** | OpenAI `text-embedding-3-small` (1536d) | + 2계층 캐시 |
| **데이터셋** | HuggingFace `nvidia/Nemotron-Personas-Korea` | 100만 행, CC BY 4.0, 26 컬럼 (페르소나 7종 + 속성·인구통계) |
| **인메모리 저장소** | pandas parquet (category dtype 최적화) + numpy `mmap_mode="r"` | RSS ~13.5GB, 검색 ~84ms |
| **영속화** | JSONL 파일 (analyses/abtests/simulations) + 디렉토리 기반 (surveys/segments) | 외부 DB 미도입 — 파일 기반 영구 |
| **운영** | pm2 (autorestart + max_memory_restart 30G) | ecosystem.config.cjs |
| **인프라** | 로컬 (해커톤 데모) — Vercel/Fly.io는 v2 | — |

---

## 데이터 흐름 (4가지 주요 흐름)

### 1. 분석 흐름 (`POST /api/analyze`)
```
[약관/카피/컨셉 입력 + 파일 업로드]
        │
        ▼
[Claude/sLLM → 소구점·타겟 추출 (tool_use)]
        │
        ▼
[OpenAI 임베딩 (캐시 hit 0ms / miss 200ms)]
        │
        ▼
[100만 행 brute-force 코사인 (84ms) + 룰·카테고리 가중치 결합]
        │
        ▼
[Cohort 분할 (core 0.5% / target 5% / interest 20%) + 인구통계 분포]
        │
        ▼
[페르소나 의견 LLM 생성 (top·bottom 병렬) + Haiku 리포트]
```

### 2. A/B 테스트 흐름 (`POST /api/abtest`)
```
[당사 정보 + 두 안(A/B) + 기준안/도전안 성격 입력]
        │
        ▼
[A·B 평행 분석 (소구점 추출 + 페르소나 매칭 + 의견)]
        │
        ▼
[비교 표 생성 (cohort 규모·평균 점수·시도·sentiment)]
        │
        ▼
[당사 관점 장단점 + FP 판매·마케팅 전략 LLM 생성]
        │
        ▼
[추천안 결정 (A / B / split 분기 운영)]
```

### 3. 페르소나 탐색 흐름 (`POST /api/dataset/personas/search`)
```
[자연어 쿼리]
        │
        ▼
[Haiku tool_use → 메타 필터 추출 (age/sex/province/occupation 등)]
        │
        ▼
[룰 필터로 후보 narrowing → 임베딩 매칭]
        │
        ▼
[임계값별 후보 규모 (0.5↑ / 0.4↑ / 0.3↑) + Top-K 카드]
```

### 4. 설문 흐름 (`/surveys` 마법사 → `survey_run`)
```
[마법사: StepBasic → Targets → Questions → Execution]
        │
        ▼
[페르소나 모집단 추출 (필터 + 사이즈)]
        │
        ▼
[질문×페르소나 LLM 호출 (answer_cache 활용)]
        │
        ▼
[진행 모니터 (실시간) → 응답 통계 → 차트 리포트 + Haiku 총평]
```

---

## 핵심 파일

| 영역 | 파일 | 역할 |
|------|------|------|
| **인메모리 저장소** | `apps/api/services/store.py` | PersonaStore 싱글톤, mmap npy, FilterParams |
| **분석 스코어링** | `apps/api/services/scoring.py` | 100만 행 cohort percentile + 인구통계 집계 |
| **LLM 추상화** | `apps/api/services/llm.py` | Anthropic/sLLM 분기, embed_text 캐싱 wrapper + per-key lock |
| **임베딩 캐시** | `apps/api/services/embed_cache.py` | 메모리 LRU 4096 + 디스크 .npy 샤딩 |
| **A/B 테스트** | `apps/api/services/abtest_llm.py`, `comparison.py` | 평행 분석 + 비교 표 + 추천 |
| **설문 엔진** | `apps/api/services/survey_engine.py`, `survey_run.py` | 질문×페르소나 LLM 실행 |
| **메인 UI** | `apps/web/app/page.tsx`, `components/SiteHeader.tsx` | 분석 페이지 + 글로벌 헤더 |
| **A/B UI** | `apps/web/components/abtest/*` | InputForm/ResultPanel/ComparisonTable/HistoryList |
| **설문 마법사** | `apps/web/components/wizard/*` | StepBasic/Targets/Questions/Execution 4단계 |
| **운영 설정** | `ecosystem.config.cjs` | pm2 정의, PERSONAS_NPY=v2 환경변수 |

---

## 빠른 시작

```bash
# 1) 의존성 설치
pnpm install                                # 프론트 워크스페이스
cd apps/api && uv sync                      # 백엔드 .venv

# 2) 환경변수 설정
cp .env.example .env                        # ANTHROPIC_API_KEY / OPENAI_API_KEY (+ SLLM_BASE_URL/SLLM_MODEL · KAKAO_MAP_APPKEY)

# 3) 데이터 준비 (이미 운영 중이라면 생략)
# - data/personas_1m.parquet, data/embeddings_1m_v2.npy 가 존재해야 함
# - 새로 만들 경우:
#   python scripts/sample_personas.py        # 100만 행 stratified
#   python scripts/embed_personas.py         # OpenAI batch 임베딩 (~$4, 5h)

# 4) 운영 (pm2)
pm2 start ecosystem.config.cjs              # web 5101 + api 5102
pm2 logs personafit-api
pm2 restart personafit-*

# 또는 직접 실행 (개발용)
pnpm --filter web dev                       # → http://localhost:3000
cd apps/api && uv run uvicorn main:app --reload --port 5102
```

### 부팅 검증
- Next.js: `curl http://localhost:5101` → HTTP 200
- FastAPI: `curl http://localhost:5102/health` → `{"ok":true,"service":"personafit-api"}`
- API 부팅 시 100만 행 npy + parquet 로드에 1~2분 소요 (mmap이지만 정규화 사본 생성)

---

## 운영 메모

- **메모리**: API 프로세스 RSS ~13.5GB (npy 5.7GB mmap + parquet 1GB + DataFrame + 정규화·캐시)
- **임베딩 캐시**: `data/embed_cache/` — 자동 누적, `.gitignore`로 제외
- **롤백 안전망**: v1 임베딩은 `data/.archive/2026-05-22_v1-npy/embeddings_1m.npy` 5.8GB 보존. `ecosystem.config.cjs`의 `PERSONAS_NPY` 변경 + pm2 restart로 복귀
- **UI 디자인 정책**: 한화 톤 10개 토큰만. Tailwind 기본 컬러(rose/emerald/amber/indigo 등) 사용 금지. 의미 매핑은 `internal/긍정 = azure`, `external/부정/주의 = terra`

---

## 상세 참조

| 문서 | 내용 |
|------|------|
| [SESSION.md](SESSION.md) | 현재 상태, 다음 작업 큐, 세션 로그 |
| [GUIDE.md](GUIDE.md) | 작업 원칙, 도메인 용어, MCP 도구 |
| [Nemotron-Personas-Korea](https://huggingface.co/datasets/nvidia/Nemotron-Personas-Korea) | 외부 데이터셋 원본 |
