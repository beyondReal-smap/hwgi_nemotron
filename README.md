# PersonaFit

> 상품설명서·약관을 입력하면 **Nemotron-Personas-Korea** 100만 합성 페르소나에서 반응할 타겟·반응도·공략 지역을 산출하는 도구.
>
> 상품기획자/FP의 타겟 전략 수립을 위한 정량 분석 보조.

---

## ✨ 핵심 기능

- 🧠 **상품 분석**: Claude Sonnet이 상품설명서·약관에서 소구점·타겟 5차원(연령/성별/가구/학력/직업)·페르소나 카테고리 가중치 추출
- 🎯 **페르소나 매칭**: 10만 행 stratified 샘플 + OpenAI 임베딩 + numpy 코사인 유사도 → 상위 20명 반응도 산출
- 📍 **공략 지역**: 17개 시도 분포 + 시군구 drill-down (상위 시도 Top 3)
- 📝 **인사이트 리포트**: Claude Haiku가 FP/기획자용 마크다운 리포트 자동 생성 (영업 화법 포함)
- 📁 **파일 업로드**: TXT · PDF · DOCX · HWP · HWPX 자동 텍스트 추출 (드래그앤드롭 지원)
- 📚 **분석 이력**: 모든 분석 결과 JSON Lines로 영속화 + `/history` 페이지에서 조회·재확인
- 🔬 **모델 검증**: Known-target 백테스트 **11/11 케이스 · 22/22 체크 통과 (100%)** — 어려운 차원(군인·지역·직군)도 임베딩 + 직업 부분 매칭으로 흡수

---

## 🧱 아키텍처

```
┌──────────────────┐         ┌──────────────────┐
│  Next.js 14 + TS │ ──→ POST│  FastAPI (uv)    │
│  Tailwind        │ /api/   │                  │
│  Recharts        │ analyze │  ┌────────────┐  │
└──────────────────┘         │  │ Anthropic  │  │
       :3000                 │  │ Sonnet/Haiku│  │
                             │  └────────────┘  │
                             │  ┌────────────┐  │
                             │  │  OpenAI    │  │
                             │  │ Embeddings │  │
                             │  └────────────┘  │
                             │  ┌────────────┐  │
                             │  │ Personas   │  │
                             │  │  parquet   │  │
                             │  │  + npy 임베딩│  │
                             │  └────────────┘  │
                             └──────────────────┘
                                    :8000
```

---

## 🚀 Quickstart

### 사전 조건

| 항목 | 버전 |
|------|------|
| Node | 20+ |
| pnpm | 11+ |
| Python | 3.12+ |
| uv | 0.11+ |
| API 키 | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` |

### 1) 의존성 설치

```bash
# 프론트
pnpm install

# 백엔드
cd apps/api && uv sync && cd ../..
```

### 2) 환경변수

```bash
cp .env.example .env
# 편집 후 ANTHROPIC_API_KEY, OPENAI_API_KEY 입력
```

### 3) 데이터 적재 (1회만, 약 11분)

```bash
# 10만 행 stratified 샘플링 → data/personas_100k.parquet (~10초)
python3 scripts/sample_personas.py

# OpenAI 임베딩 batch → data/embeddings_100k.npy (15-30분, ~$0.24)
python3 scripts/embed_personas.py
```

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
pm2 restart all
pm2 stop all
pm2 delete all
```

브라우저로 **`http://localhost:5101`** 접속.

> 포트 구조:
> - **5101** — Next.js (외부 노출). `/api/*`는 내부적으로 5102로 프록시 (Next.js rewrites)
> - **5102** — FastAPI (127.0.0.1 only, 외부 접근 차단)
> - 단일 포트(5101)만 노출하면 되므로 CORS·역방향 프록시 별도 설정 불필요

### 4-alt) 개발 모드 (pm2 없이)

```bash
# 백엔드 (터미널 1)
cd apps/api && uv run uvicorn main:app --reload --port 5102

# 프론트 (터미널 2)
pnpm --filter web dev          # http://localhost:3000
# (dev 모드는 Next.js 기본 3000 포트, .env의 API_INTERNAL_URL=http://127.0.0.1:5102 사용)
```

---

## 📂 디렉토리 구조

```
ai_hack/
├── apps/
│   ├── web/                          # Next.js 14 + Tailwind + Recharts
│   │   ├── app/
│   │   │   ├── page.tsx              # 메인 (분석 입력 + 결과)
│   │   │   └── history/page.tsx      # 분석 이력 페이지
│   │   ├── components/               # SiteHeader + InputForm + ScoreCard + PersonaList + RegionChart + ReportPanel
│   │   └── lib/api.ts                # FastAPI 호출 클라이언트 + 타입
│   └── api/                          # FastAPI + uv
│       ├── main.py                   # 진입점 (/health, /api/*)
│       ├── models/schemas.py         # Pydantic 요청·응답 스키마 (SellingPoints 5차원 타겟)
│       ├── services/
│       │   ├── store.py              # 인메모리 페르소나 저장소 (parquet+npy) + FilterParams
│       │   ├── scoring.py            # 룰 필터 + 코사인 + 가중치 결합
│       │   ├── llm.py                # Claude Sonnet+Haiku + OpenAI 임베딩 + tool_use
│       │   ├── text_extractor.py     # TXT/PDF/DOCX/HWP/HWPX 텍스트 추출
│       │   └── persistence.py        # 분석 이력 (JSON Lines)
│       ├── prompts/                  # selling_points.md, report.md
│       └── routes/
│           ├── analyze.py            # POST /api/analyze
│           ├── extract.py            # POST /api/extract-text
│           └── analyses.py           # GET /api/analyses, /api/analyses/{id}
├── scripts/
│   ├── sample_personas.py            # 10만 행 stratified 샘플링
│   ├── dump_personas_full.py         # 100만 행 전체 dump (제출용)
│   ├── embed_personas.py             # OpenAI 임베딩 batch (env로 입출 경로)
│   ├── validate_known_targets.py     # Known-target 백테스트
│   └── explore_personas.py           # 데이터셋 탐색 (참고용)
├── data/                             # (gitignored) parquet, npy, analyses.jsonl
├── docs/
│   ├── samples/                      # 약관 샘플 (TXT/PDF/DOCX/HWPX)
│   ├── VALIDATION.md                 # 자동 생성 검증 리포트
│   └── VALIDATION_STORY.md           # 발표용 검증 스토리
├── agent-guide/                      # AI 에이전트 가이드 + 계획서
└── ecosystem.config.cjs              # pm2 설정 (web 5101, api 5102)
```

---

## 🔬 알고리즘

### 반응도 스코어링

```
1) 룰 필터 5차원 → 후보 수천 명
   (age / sex / family_type / education_level / occupation*)
2) 후보가 부족하면(<200) 룰 완화 → 전체 100k
3) numpy 코사인 유사도 top 200
4) 점수 결합:
   score = 0.7 × cosine + 0.2 × rule_bonus + 0.1 × category_bonus
   rule_bonus 가중치: 연령 0.35 / 성별 0.15 / 가구 0.15 / 학력 0.15 / 직업 0.20
5) 0-100 정규화 → 상위 50명 반환
6) 시도/시군구 집계

* occupation은 부분 매칭 (자유텍스트, KSCO + "무직/전직/구직중" 등 비경제활동 표현)
```

### LLM 모델 분리

| 용도 | 모델 | 이유 |
|------|------|------|
| 소구점 추출 | `claude-sonnet-4-6` | 구조화 JSON 추출 정확도 (tool_use 강제) |
| 리포트 생성 | `claude-haiku-4-5` | 텍스트 생성 위주, 속도·비용 최적 |
| 임베딩 | `text-embedding-3-small` | 1536d, 저비용, 한국어 성능 양호 |

---

## 🔬 모델 검증

PersonaFit은 **Known-target 백테스트**로 모델 정확도를 정량 측정합니다.

- 정답이 명시된 보험 약관 **11종** (여성전용/시니어/유자녀/청년/전문직/미혼1인/은퇴자/남성전용/**군인**/**제주도**/**간호사**)
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

> 인사이트: 군인 케이스에서 `military_status` 필드가 `SellingPoints`에 없는데도 **9/10 = 90% 현역** 매칭 (occupation "병사/장교/부사관" 부분 매칭). 제주 케이스는 인구 1.4%인 지역이 상위 20명 중 **50%로 36배 over-representation** (임베딩이 "감귤·해녀·자연재해" 키워드를 통해 간접 매칭).

상세 스토리: [`docs/VALIDATION_STORY.md`](docs/VALIDATION_STORY.md)

### 검증의 한계 (정직하게)

이 검증은 **모델이 명시적 타겟을 잡는 일관성**만 측정합니다. 다음은 별도 검증 필요:
- 합성 페르소나가 실제 한국인을 얼마나 닮았는가
- 추천 페르소나가 **실제로** 가입할 확률
- 마케팅 캠페인 실제 전환율 → A/B 테스트 또는 보험사 사내 데이터 필요

### 재현

```bash
python3 scripts/validate_known_targets.py
# → docs/VALIDATION.md, docs/VALIDATION.json
```

---

## ⚡ 성능 (실측, M-class 클라우드)

| 단계 | 소요 |
|------|------|
| Sonnet 소구점 추출 | 7-9초 |
| OpenAI 임베딩 (단건) | 0.5-1.5초 |
| 인메모리 스코어링 (100k) | 0.4-0.5초 |
| Haiku 리포트 생성 | 11-12초 |
| **합계** | **19-25초** |

> 첫 요청은 store 로드 1.6초 추가. 30초 SLA 마진 충분.

---

## 💰 비용 (분석 1회당)

- Sonnet (입력 ~5K + 출력 ~500 토큰): ~$0.018
- Haiku (입력 ~3K + 출력 ~1500 토큰): ~$0.0035
- OpenAI 임베딩 (입력 1건): ~$0.000002
- **합계: 약 $0.022** (100회 분석 = $2.2)

> 10만 행 사전 임베딩 비용: ~$0.24 (1회만)

---

## 📚 데이터 출처

[**nvidia/Nemotron-Personas-Korea**](https://huggingface.co/datasets/nvidia/Nemotron-Personas-Korea)

- 라이선스: **CC BY 4.0** (상업적 이용 가능)
- 규모: 100만 합성 한국인 페르소나 (1.7B 토큰)
- 컬럼: 7개 페르소나 텍스트(`persona`, `professional_persona`, `sports_persona`, `arts_persona`, `travel_persona`, `culinary_persona`, `family_persona`) + 인구통계 6 + 지역(17 시도, 252 시군구)
- 생성: NVIDIA NeMo Data Designer + Gemma 모델, KOSIS·대법원·국민건강보험공단·KREI 데이터 기반

> 본 프로젝트는 NVIDIA Nemotron-Personas-Korea의 합성 데이터를 사용하며, 모든 분석 결과는 합성 페르소나 기준입니다. 실제 인물·데이터와 무관합니다.

---

## 📋 라이선스

- 본 프로젝트 코드: **MIT** (또는 팀 정책)
- 데이터: nvidia/Nemotron-Personas-Korea (CC BY 4.0)
- LLM 모델: Anthropic/OpenAI 각사 약관

---

## 🤝 기여 가이드

`agent-guide/` 디렉토리의 문서를 먼저 확인:
- `GUIDE.md` — 작업 원칙, 용어 정리
- `PROJECT.md` — 프로젝트 구조, 기술 스택
- `SESSION.md` — 현재 상태, 다음 작업

AI 에이전트 워크플로우는 `agent-guide/plans/` 하위의 계획서 참고.
