# PersonaFit

> 상품설명서·약관·마케팅 카피·신상품 컨셉을 입력하면 **100만 합성 한국인 페르소나**(NVIDIA Nemotron-Personas-Korea)와 매칭해 **반응 타겟·반응도·공략 지역·페르소나 의견·FP 판매 전략·A/B 비교·가상 설문 응답**까지 산출하는 상품 기획·마케팅 분석 도구.
>
> 상품기획자/FP의 타겟 전략 수립을 위한 정량 분석 보조.

---

## ✨ 핵심 기능 (9개)

| # | 페이지 | 기능 |
|---|--------|------|
| 1 | `/` 분석 | 약관·카피·컨셉 → 소구점 추출 → 페르소나 매칭 → 인메모리 100만 행 cohort 통계 → 페르소나 의견 + FP 리포트 |
| 2 | `/abtest` | 두 안(약관·카피·컨셉) 평행 분석 + 비교 표 + 추천안 + 당사 관점 장단점 + FP 판매 전략 |
| 3 | `/personas` | 자연어 페르소나 검색 (시멘틱 + 메타 필터 자동 추출) + 카드 그리드 + 상세 모달 + 세그먼트 저장 |
| 4 | `/surveys` | 설문 마법사(StepBasic → Targets → Questions → Execution) + 진행 모니터 + 응답 통계 + 차트 리포트 |
| 5 | `/overview` | 데이터셋 전체 통계 시각화 (분포·집계) |
| 6 | `/history` | 과거 분석 이력 다시 보기 |
| 7 | `/abtest?mode=history` | A/B 테스트 이력 조회·관리 |
| 8 | 시뮬레이션 | 페르소나 가상 응답 (분석 결과 페이지 내 호출) |
| 9 | 파일 업로드 | TXT · PDF · DOCX · HWP · HWPX 자동 텍스트 추출 (드래그앤드롭 지원) |

추가 특징:

- 📁 **파일 업로드** — TXT/PDF/DOCX/HWP/HWPX 다섯 가지 포맷 자동 추출 (InputForm + ABTestInputForm 공통)
- 📚 **분석 이력** — 모든 분석·A/B·시뮬레이션을 JSONL로 영속화, 페이지에서 즉시 재조회
- 🔬 **모델 검증** — Known-target 백테스트 **11/11 케이스 · 22/22 체크 통과 (100%)**

---

## 🧱 아키텍처

```
┌──────────────────────┐         ┌────────────────────────────┐
│  Next.js 14 + TS     │ ──→ POST│  FastAPI (uv, Python 3.12) │
│  Tailwind (한화 톤)   │ /api/*  │                            │
│  Recharts            │         │  ┌──────────────────────┐  │
└──────────────────────┘         │  │ sLLM (vLLM Qwen3.6   │  │
       :5101 (외부)              │  │  -27B-FP8, OpenAI 호환)│ │
       ↓ rewrites                │  └──────────────────────┘  │
       127.0.0.1:5102 (내부)     │  ┌──────────────────────┐  │
                                 │  │ OpenAI Embeddings    │  │
                                 │  │ text-embedding-3-small│ │
                                 │  │ + 2계층 캐시          │  │
                                 │  └──────────────────────┘  │
                                 │  ┌──────────────────────┐  │
                                 │  │ Personas 100만 행     │  │
                                 │  │ parquet 930MB +       │  │
                                 │  │ npy 5.8GB (mmap)      │  │
                                 │  └──────────────────────┘  │
                                 └────────────────────────────┘
```

> **LLM 호출 정책**: sLLM (Qwen3.6-27B-FP8) 단일 호출. Anthropic Claude SDK·구현체는 향후 복귀를 위해 코드 보존하되 호출 진입부에서 `provider = "sllm"` 강제 차단.

---

## 🚀 Quickstart

### 사전 조건

| 항목 | 버전 |
|------|------|
| Node | 20+ |
| pnpm | 11+ |
| Python | 3.12+ |
| uv | 0.11+ |
| API 키 | `OPENAI_API_KEY` (임베딩), `SLLM_BASE_URL` (vLLM 엔드포인트). `ANTHROPIC_API_KEY`는 옵션 (현재 미호출) |

### 1) 의존성 설치

```bash
# 프론트 (워크스페이스)
pnpm install

# 백엔드
cd apps/api && uv sync && cd ../..
```

### 2) 환경변수

```bash
cp .env.example .env
# 편집:
#   OPENAI_API_KEY=sk-...                       # 임베딩
#   SLLM_BASE_URL=http://3.38.195.121:5015/v1   # 미설정 시 default 사용
#   SLLM_MODEL=                                 # 미설정 시 /v1/models 첫 모델 자동 선택
#   NEXT_PUBLIC_KAKAO_MAP_APPKEY=...            # (선택) 시군구 분포 지도
```

### 3) 데이터 적재 (1회)

운영 데이터셋이 없을 때만 실행. 이미 `data/personas_1m.parquet` + `data/embeddings_1m_v2.npy`가 있으면 생략.

```bash
# 100만 행 stratified 샘플링 → data/personas_1m.parquet (~930MB)
python scripts/sample_personas.py

# OpenAI 임베딩 batch (combined: 페르소나 7종 + 속성 3종)
#   → data/embeddings_1m_v2.npy (~5.8GB, ~$4, 약 5h)
python scripts/embed_personas.py
```

개발용 10만 행 샘플은 `python scripts/sample_personas.py`의 `SAMPLE_TARGET_TOTAL=100000` 옵션 활용.

### 4) 실행 (pm2)

```bash
# Next.js 프로덕션 빌드 (1회)
pnpm --filter web build

# pm2로 두 서비스 등록·시작
pm2 start ecosystem.config.cjs

# 상태 확인
pm2 list
pm2 logs personafit-web
pm2 logs personafit-api

# 재시작 / 종료
pm2 restart personafit-*
pm2 stop all
pm2 delete all
```

브라우저로 **`http://localhost:5101`** 접속.

> **포트 구조**
> - **5101** — Next.js (외부 노출). `/api/*`는 내부적으로 5102로 프록시 (Next.js rewrites)
> - **5102** — FastAPI (127.0.0.1 only, 외부 차단)
> - 단일 포트(5101)만 노출하면 되므로 CORS·역방향 프록시 별도 설정 불필요
> - API 부팅 시 100만 행 npy + parquet 로드에 **1~2분** 소요 (mmap이지만 정규화 사본 생성)

### 4-alt) 개발 모드 (pm2 없이)

```bash
# 백엔드 (터미널 1)
cd apps/api && uv run uvicorn main:app --reload --port 5102

# 프론트 (터미널 2)
pnpm --filter web dev          # http://localhost:3000
# (dev 모드는 Next.js 기본 3000 포트, .env의 API_INTERNAL_URL=http://127.0.0.1:5102 사용)
```

### 부팅 검증

```bash
curl http://localhost:5101                       # → HTTP 200
curl http://localhost:5102/health                # → {"ok":true,"service":"personafit-api"}
```

---

## 📂 디렉토리 구조

```
ai_hack/
├── apps/
│   ├── web/                          # Next.js 14 App Router + Tailwind + Recharts
│   │   ├── app/
│   │   │   ├── page.tsx              # / 분석 (InputForm + ScoreCard + PersonaList + KoreaMap + ReportPanel)
│   │   │   ├── abtest/               # /abtest A/B 테스트 (+ ?mode=history)
│   │   │   ├── personas/             # /personas 자연어 탐색
│   │   │   ├── surveys/              # /surveys 마법사 + 이력 + /[id]/{progress,responses,report}
│   │   │   ├── survey/[analysisId]/  # 분석에서 시작한 가상 설문
│   │   │   ├── overview/             # /overview 데이터셋 통계
│   │   │   ├── history/              # /history 분석 이력
│   │   │   └── fonts/                # SUITE Variable 본문 폰트
│   │   ├── components/               # 27개 + abtest/ 4개 + wizard/ 8개
│   │   ├── lib/api.ts                # FastAPI 호출 클라이언트 + 타입
│   │   ├── tailwind.config.ts        # 한화 톤 10개 토큰
│   │   └── next.config.mjs           # API rewrites (/api/* → 127.0.0.1:5102)
│   └── api/                          # FastAPI + uv (Python 3.12)
│       ├── main.py                   # 진입점 + 라우터 등록
│       ├── routes/                   # 14개 라우트 (analyze/abtest/dataset/segments/surveys/...)
│       ├── services/                 # 21개 서비스 (store/scoring/llm/embed_cache/...)
│       ├── prompts/                  # 7개 LLM 시스템 프롬프트
│       ├── models/                   # Pydantic 스키마 + 설문 도메인 모델
│       └── pyproject.toml
├── scripts/
│   ├── sample_personas.py            # 100만 행 stratified 샘플링
│   ├── embed_personas.py             # OpenAI batch 임베딩 (combined)
│   ├── validate_known_targets.py     # Known-target 백테스트
│   ├── backfill_commentaries.py      # 설문 리포트 총평 backfill
│   └── explore_personas.py           # 데이터셋 탐색
├── data/                             # (gitignored)
│   ├── personas_1m.parquet           # 930MB — 100만 행 메타
│   ├── embeddings_1m_v2.npy          # 5.8GB — 통합 임베딩 (combined v2)
│   ├── analyses.jsonl                # 분석 이력
│   ├── abtests.jsonl                 # A/B 테스트 이력
│   ├── simulations.jsonl             # 시뮬레이션 결과
│   ├── surveys/                      # 설문 정의·진행·응답
│   ├── segments/                     # 사용자 세그먼트
│   ├── answer_cache/                 # 페르소나 응답 캐시 (sha256 샤딩)
│   └── embed_cache/                  # 임베딩 캐시 (sha256 샤딩, .npy)
├── docs/
│   ├── samples/                      # 약관 샘플 (TXT/PDF/DOCX/HWPX)
│   ├── VALIDATION.md                 # 자동 생성 검증 리포트
│   └── VALIDATION_STORY.md           # 발표용 검증 스토리
├── agent-guide/                      # AI 에이전트 가이드 + 계획서
└── ecosystem.config.cjs              # pm2 설정 (web 5101 / api 5102)
```

---

## 🔄 데이터 흐름

### 1. 분석 (`POST /api/analyze`)

```
[약관/카피/컨셉 입력 + 파일 업로드]
        ▼
[sLLM → 소구점·타겟 추출 (tool_use)]
        ▼
[OpenAI 임베딩 (캐시 hit 0ms / miss ~200ms)]
        ▼
[100만 행 brute-force 코사인 (~84ms) + 룰·카테고리 가중치 결합]
        ▼
[Cohort 분할 (core 0.5% / target 5% / interest 20%) + 인구통계 분포]
        ▼
[페르소나 의견 LLM 생성 (top·bottom 병렬) + 리포트]
```

### 2. A/B 테스트 (`POST /api/abtest`)

```
[당사 정보 + 두 안(A/B) + 기준안/도전안 성격]
        ▼
[A·B 평행 분석 (소구점 추출 + 페르소나 매칭 + 의견)]
        ▼
[비교 표 (cohort 규모·평균 점수·시도·sentiment)]
        ▼
[당사 관점 장단점 + FP 판매·마케팅 전략 LLM 생성]
        ▼
[추천안 결정 (A / B / split 분기 운영)]
```

### 3. 페르소나 탐색 (`POST /api/dataset/personas/search`)

```
[자연어 쿼리]
        ▼
[LLM tool_use → 메타 필터 추출 (age/sex/province/occupation...)]
        ▼
[룰 필터로 후보 narrowing → 임베딩 매칭]
        ▼
[임계값별 후보 규모 (0.5↑ / 0.4↑ / 0.3↑) + Top-K 카드]
```

### 4. 설문 (`/surveys` 마법사 → `survey_run`)

```
[StepBasic → Targets → Questions → Execution]
        ▼
[페르소나 모집단 추출 (필터 + 사이즈)]
        ▼
[질문×페르소나 LLM 호출 (answer_cache 활용)]
        ▼
[진행 모니터 (실시간) → 응답 통계 → 차트 리포트 + 총평]
```

---

## 🔬 알고리즘

### 반응도 스코어링

```
1) 룰 필터 5차원 → 후보 narrowing
   (age / sex / family_type / education_level / occupation*)
2) 후보가 부족하면 룰 완화 → 전체 100만
3) numpy 코사인 유사도 (brute-force, ~84ms / 100만 행)
4) 점수 결합:
   score = 0.7 × cosine + 0.2 × rule_bonus + 0.1 × category_bonus
   rule_bonus 가중치: 연령 0.35 / 성별 0.15 / 가구 0.15 / 학력 0.15 / 직업 0.20
5) 0-100 정규화 → 상위 50명 반환
6) 시도/시군구 집계 + cohort 분할 (core/target/interest)

* occupation은 부분 매칭 (KSCO + "무직/전직/구직중" 등 비경제활동 표현)
```

### LLM·임베딩 모델

| 용도 | 모델 | 비고 |
|------|------|------|
| 소구점 추출 / 의견 / 리포트 / A/B / 설문 응답 | **sLLM** (vLLM `Qwen3.6-27B-FP8`, OpenAI 호환) | `DEFAULT_PROVIDER=sllm` 단일 호출. Anthropic SDK 보존하되 호출 차단 |
| 임베딩 | OpenAI `text-embedding-3-small` (1536d) | + 2계층 캐시 (메모리 LRU 4096 + 디스크 .npy 샤딩) |

---

## 🔬 모델 검증

PersonaFit은 **Known-target 백테스트**로 모델 정확도를 정량 측정합니다.

- 정답이 명시된 보험 약관 **11종** (여성전용 / 시니어 / 유자녀 / 청년 / 전문직 / 미혼1인 / 은퇴자 / 남성전용 / **군인** / **제주도** / **간호사**)
- 각 케이스에 대해 1~3개 자동 체크 (성별·연령·가구·학력·직업·지역·군복무 등 분포 비율)

### 최종 결과

| 지표 | 값 |
|------|-----|
| 케이스 통과 | **11 / 11 (100%)** |
| 체크 통과 | **22 / 22 (100%)** |

### 5단계 진화

| 단계 | 케이스 | 체크 | 통과율 | 동인 |
|------|-------|------|--------|------|
| ① 초기 | 5 | 8 | 87.5% | 베이스라인 |
| ② 스키마 확장 | 5 | 8 | **100%** | `target_education_levels`, `target_occupations` 추가 |
| ③ 케이스 확장 | 8 | 15 | 93.3% | 더 어려운 3종 추가 |
| ④ 평가+프롬프트 보완 | 8 | 15 | **100%** | 데이터셋 표현 다양성 흡수 |
| ⑤ 어려운 차원 추가 | 11 | 22 | **100%** | 군인/제주(지역)/간호사 — 스키마 없는 차원도 흡수 |

> 인사이트: 군인 케이스에서 `military_status` 필드가 스키마에 없는데도 **9/10 = 90% 현역** 매칭 (occupation "병사/장교/부사관" 부분 매칭). 제주 케이스는 인구 1.4%인 지역이 상위 20명 중 **50%로 36배 over-representation** (임베딩이 "감귤·해녀·자연재해" 키워드를 통해 간접 매칭).

상세 스토리: [`docs/VALIDATION_STORY.md`](docs/VALIDATION_STORY.md)

### 검증의 한계 (정직하게)

이 검증은 **모델이 명시적 타겟을 잡는 일관성**만 측정합니다. 다음은 별도 검증 필요:

- 합성 페르소나가 실제 한국인을 얼마나 닮았는가
- 추천 페르소나가 **실제로** 가입할 확률
- 마케팅 캠페인 실제 전환율 → A/B 테스트 또는 보험사 사내 데이터 필요

### 재현

```bash
python scripts/validate_known_targets.py
# → docs/VALIDATION.md, docs/VALIDATION.json
```

---

## ⚡ 성능 (실측)

| 단계 | 소요 |
|------|------|
| sLLM 소구점 추출 (tool_use) | 7-9초 |
| OpenAI 임베딩 (단건, 캐시 miss) | 0.5-1.5초 |
| 임베딩 (캐시 hit) | < 1ms |
| 인메모리 brute-force 코사인 (100만 행) | ~84ms |
| sLLM 리포트 생성 | 11-12초 |
| **분석 전체** | **19-25초** |

> 첫 요청은 store 로드 1.6초 추가. 30초 SLA 마진 충분.

### 메모리·디스크

- **API 프로세스 RSS**: ~13.5GB (npy 5.7GB mmap + parquet 1GB + 정규화 DataFrame + 임베딩 캐시 LRU ≈24MB)
- **데이터**: `personas_1m.parquet` 930MB + `embeddings_1m_v2.npy` 5.8GB
- **임베딩 캐시**: `data/embed_cache/` 자동 누적, retention 정책으로 N일 미접근·M개 초과 시 oldest 삭제

---

## 💰 비용 (분석 1회당, 참고)

- sLLM (소구점 추출 + 리포트): **자체 호스팅 vLLM** (외부 LLM API 호출 없음 — Anthropic 호출 차단)
- OpenAI 임베딩 (단건): ~$0.000002
- **합계: 사실상 임베딩 비용만** (캐시 hit 시 $0)

> 100만 행 사전 임베딩 1회: ~$4

---

## 🎨 UI 디자인 정책 (한화 톤)

- **사용 토큰**: `vellum / ink / onyx / graphite / dusty / stone / parchment / snow / azure / terra` 10종만
- **사용 금지**: Tailwind 기본 컬러 (rose/emerald/amber/indigo 등)
- **의미 매핑**:
  - `internal / 긍정 / 안정` → **azure**
  - `external / 부정 / 주의` → **terra**
  - `경고 옅게` → `terra/8` 패턴
- **본문 폰트**: SUITE Variable

---

## 🛠️ 운영 메모

- **pm2 autorestart** + `max_memory_restart 30G` (ecosystem.config.cjs)
- **롤백 안전망**: v1 임베딩은 `data/.archive/2026-05-22_v1-npy/embeddings_1m.npy` 5.8GB 보존. `ecosystem.config.cjs`의 `PERSONAS_NPY` 변경 + pm2 restart로 즉시 복귀
- **답변 캐시**: `data/answer_cache/` — `persona × question × model × temp` 키로 sha256 샤딩 영속화
- **이력 영속화**: 모든 JSONL/디렉토리 기반 (외부 DB 미도입)

---

## 📚 데이터 출처

[**nvidia/Nemotron-Personas-Korea**](https://huggingface.co/datasets/nvidia/Nemotron-Personas-Korea)

- 라이선스: **CC BY 4.0** (상업적 이용 가능)
- 규모: 100만 합성 한국인 페르소나 (1.7B 토큰)
- 컬럼: 7개 페르소나 텍스트(`persona`, `professional_persona`, `sports_persona`, `arts_persona`, `travel_persona`, `culinary_persona`, `family_persona`) + 인구통계 6 + 지역(17 시도, 252 시군구)
- 생성: NVIDIA NeMo Data Designer + Gemma 모델, KOSIS·대법원·국민건강보험공단·KREI 데이터 기반

> 본 프로젝트는 NVIDIA Nemotron-Personas-Korea의 **합성 데이터**를 사용하며, 모든 분석 결과는 합성 페르소나 기준입니다. 실제 인물·데이터와 무관합니다.

---

## 📋 라이선스

- 본 프로젝트 코드: **MIT** (또는 팀 정책)
- 데이터: nvidia/Nemotron-Personas-Korea (CC BY 4.0)
- LLM 모델: 자체 호스팅 sLLM (vLLM), OpenAI 임베딩 각사 약관

---

## 🤝 기여 가이드

`agent-guide/` 디렉토리의 문서를 먼저 확인:

- [`GUIDE.md`](agent-guide/GUIDE.md) — 작업 원칙, 도메인 용어, MCP 도구
- [`PROJECT.md`](agent-guide/PROJECT.md) — 프로젝트 구조, 기술 스택, 핵심 파일
- [`SESSION.md`](agent-guide/SESSION.md) — 현재 상태, 다음 작업 큐

AI 에이전트 워크플로우는 [`agent-guide/plans/`](agent-guide/plans/) 하위의 계획서 참고.
