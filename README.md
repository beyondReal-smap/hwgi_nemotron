# PersonaFit

> **상품설명서·약관·마케팅 카피·신상품 컨셉**을 입력하면, **100만 명의 합성 한국인 페르소나**와 매칭해 _"누가 얼마나 반응할지 · 어느 지역을 공략할지 · 사람들이 뭐라고 말할지 · FP가 어떻게 팔지 · A안과 B안 중 뭐가 나은지"_ 까지 한 번에 뽑아 주는 **상품 기획·마케팅 분석 도구**입니다.

---

## 🙋 쉽게 말하면

새 보험 상품(또는 카피, 컨셉)을 만들었습니다. 출시 전에 묻고 싶습니다.

- **"이거, 누구한테 먹힐까?"** → 100만 가상 한국인 중 가장 반응할 사람들의 나이·성별·가구·직업·사는 곳을 알려 줍니다.
- **"실제로 사람들은 뭐라고 할까?"** → 페르소나가 직접 1인칭으로 의견을 말합니다 (좋다는 사람, 반대하는 사람 둘 다).
- **"A안과 B안 중 뭐가 낫지?"** → 두 안을 같은 100만 명에게 동시에 돌려 비교표·추천안·판매 전략까지 줍니다.
- **"설문조사 한번 돌려보고 싶은데 시간·비용이…"** → 페르소나에게 가상 설문을 던지면 응답 통계·차트가 몇 분 만에 나옵니다.

실제 사람에게 묻기 전, **AI 포커스 그룹**으로 빠르게 예행연습을 하는 셈입니다.

> ⚠️ **정직성 원칙**: 모든 결과는 **합성(가상) 페르소나** 기준입니다. 실제 가입 확률·전환율이 아니라 _"타겟 적합도와 반응 경향"_ 을 정량화한 것입니다. 한계는 [모델 검증](#-모델-검증) 섹션에 솔직하게 적어 두었습니다.

---

## 📑 목차

1. [한눈에 보기](#-한눈에-보기)
2. [핵심 기능](#-핵심-기능)
3. [화면(페이지) 안내](#-화면페이지-안내)
4. [작동 원리 (쉽게)](#-작동-원리-쉽게)
5. [아키텍처](#-아키텍처)
6. [점수는 어떻게 매겨지나 (알고리즘)](#-점수는-어떻게-매겨지나-알고리즘)
7. [기술 스택](#-기술-스택)
8. [디렉토리 구조](#-디렉토리-구조)
9. [API 엔드포인트](#-api-엔드포인트)
10. [Quickstart (설치·실행)](#-quickstart-설치실행)
11. [모델 검증](#-모델-검증)
12. [성능·비용](#-성능비용)
13. [UI 디자인 정책](#-ui-디자인-정책)
14. [운영 메모](#-운영-메모)
15. [용어 사전](#-용어-사전)
16. [데이터 출처·라이선스](#-데이터-출처라이선스)

---

## 🔎 한눈에 보기

| 항목 | 내용 |
|------|------|
| **무엇** | 상품/카피/컨셉을 100만 페르소나와 매칭하는 기획·마케팅 분석 도구 |
| **누구를 위해** | 보험·금융 상품 기획자, FP(설계사), 마케터 |
| **데이터** | `nvidia/Nemotron-Personas-Korea` 100만 행 (CC BY 4.0) — 전부 메모리에 적재 |
| **프론트엔드** | Next.js 14 (App Router) + TypeScript + Tailwind(한화 톤) + Recharts |
| **백엔드** | FastAPI + Python 3.12 (`uv` 패키지 관리) |
| **LLM** | 멀티 provider(**OpenAI / sLLM / Anthropic**) — 관리자 페이지에서 전역 전환. 현재 운영값 **OpenAI `gpt-5.4`** |
| **임베딩** | **KURE-v1** (한국어 특화 로컬 임베딩, 1024d) — 2계층 캐시. *(OpenAI `text-embedding-3-small` 1536d에서 전환 진행 중)* |
| **검색 방식** | 100만 행 **brute-force 코사인** (~84ms) — HNSW 미사용 (전체 모집단 통계가 필요해서) |
| **저장소** | 외부 DB 없음 — 모든 이력을 **JSONL/파일**로 영속화 |
| **운영** | pm2 — `personafit-web`(5101, 외부) / `personafit-api`(5102, 내부) |

---

## ✨ 핵심 기능

각 기능을 **"무엇을 하나요 → 어떻게 쓰나요 → 무엇이 나오나요"** 순서로 설명합니다.

### 1. 📋 상품 분석 (`/analyze`)
- **무엇** — 약관·상품설명서·카피·신상품 컨셉을 넣으면 가장 반응할 타겟과 그 이유를 분석합니다.
- **어떻게** — 텍스트를 붙여넣거나 파일(TXT·PDF·DOCX·HWP·HWPX)을 드래그앤드롭. 한화 상품 카탈로그에서 바로 고를 수도 있습니다.
- **무엇이 나오나요**
  - **반응 강도 카드** — 100만 명 중 핵심 반응층 인원, 1순위 공략 지역, 평균 점수
  - **점수 DNA(워터폴)** — 점수가 _의미 적합도(임베딩) + 룰 보너스 + 관심사 + 보험관심_ 중 무엇으로 만들어졌는지 분해
  - **타겟 인구통계 분포** — 나이·성별·가구·학력·직업 도넛/막대 + **baseline-lift**(전체 모집단 대비 몇 배 과대표집되는지)
  - **공략 지역 지도** — 시도/시군구별 반응 집중도 (Kakao 지도)
  - **페르소나 의견** — 상·중·하위 페르소나가 1인칭으로 말하는 찬반 의견 + 반대 의견(ObjectionPanel)
  - **숨은 세그먼트 발굴** — "의외로 강하게 반응하는 교차 그룹"(예: 40대 × 자영업 × 부산)을 lift 순으로
  - **AI 리포트** — FP/기획자용 마크다운 종합 총평
  - **What-if 실험실**(아래 6번)으로 즉석 시뮬레이션

### 2. 🆚 A/B 테스트 (`/abtest`)
- **무엇** — 두 안(A/B)을 같은 100만 명에게 동시에 돌려 정량 비교합니다.
- **어떻게** — 당사 정보 + A안/B안 텍스트 입력. 기준안/도전안 성격 지정.
- **무엇이 나오나요**
  - **비교표** — 코호트 규모·평균 점수·1순위 시도·sentiment를 A vs B로 나란히
  - **겹침 벤다이어그램(OverlapVenn)** — A만 / 공통 / B만 반응하는 인원
  - **카테고리 발산도(CategoryDivergence)** — 관심사별로 A와 B가 어디서 갈리는지
  - **스윙층 X-레이(SwingLayerXray)** — A↔B 사이에서 흔들리는 층 분석
  - **추천안 + 분할 운영 플레이북(SplitPlaybook)** — "A로 갈지, B로 갈지, 아니면 층을 나눠 둘 다 운영할지"와 FP 판매 전략

### 3. 🧩 겹침 분석 (`/cannibal`)
- **무엇** — 안이 **3개 이상**일 때 서로 반응층이 얼마나 겹치는지(자기잠식) 분석합니다.
- **어떻게** — 여러 안을 입력 → 집합 연산으로 코호트 겹침 계산 (LLM 호출 0).
- **무엇이 나오나요** (탭 4개)
  - **겹침 행렬** — 안끼리의 반응층 겹침도(방향성 + Jaccard)
  - **커버리지** — 안을 몇 개 합쳐야 시장을 얼마나 덮는지(greedy union)
  - **노출 분포** — 한 사람이 몇 개 안에 반응하는지
  - **전용층** — 각 안에만 반응하는 고유 그룹 + 인구통계·지도

### 4. 🔍 페르소나 탐색 (`/personas`)
- **무엇** — 100만 페르소나를 자연어/필터로 검색합니다.
- **어떻게** — "40대 부모와 동거하는 자영업자" 같은 자연어를 입력하면, 시스템이 자동으로 나이·가구·직업 같은 메타 조건을 뽑아 정확히 좁힙니다. 사이드바 필터도 병행.
- **무엇이 나오나요** — 매칭 인원 + 카드/테이블 그리드 + 페르소나 상세 모달. 마음에 드는 결과를 **세그먼트로 저장**해 설문 대상으로 재사용.

### 5. 🗳️ 가상 설문 (`/surveys`)
- **무엇** — 페르소나에게 직접 설문을 돌려 응답 통계를 얻습니다.
- **어떻게** — 4단계 마법사: ① 기본 정보 → ② 대상(세그먼트/필터) → ③ 질문(직접 작성 또는 Excel/Word 임포트, AI 질문 추천) → ④ 실행.
- **무엇이 나오나요**
  - **실시간 진행 모니터** — 응답률·평균 응답시간·토큰, 막 끝난 응답 티커
  - **질문별 응답 통계** — 선택형/척도형/개방형 차트 리포트
  - **CSV 내보내기** — 페르소나 메타 + 질문별 답변/근거/확신도
  - **AI 총평** — 설문 결과 종합 코멘터리

### 6. 🎛️ What-if 실험실 (분석 화면 내)
- **무엇** — 슬라이더로 **타겟 조건·관심사 가중치**를 바꾸면 100만 분포가 **즉시** 재계산됩니다.
- **어떻게** — 연령/성별/관심사(전문직·스포츠·예술·여행·요리·가정) 슬라이더를 움직이면 350ms 디바운스로 재점수.
- **무엇이 나오나요** — 원본 대비 **델타**(핵심타겟 인원 ±, 평균 점수 ±, 분포·숨은 세그먼트 변화). 이미 임베딩이 캐시돼 있어 **임베딩 API 0콜**로 ~수십 ms에 응답.

### 7. 📊 데이터 현황 (`/overview`)
- 100만 행 데이터셋 자체를 둘러보는 대시보드 — 지역 지도, 인구통계 분포, 직업군 Top, 페르소나 텍스트 샘플.

### 8. 🗂️ 이력·세그먼트 (전 기능 공통)
- 모든 분석/A·B/겹침/설문/시뮬레이션을 **JSONL로 영속화** → 언제든 다시 열람·삭제. 저장한 세그먼트는 설문 대상으로 재사용.

### 9. ⚙️ 관리자 (`/admind`)
- LLM provider(OpenAI/sLLM/Anthropic)와 모델을 골라 **전역으로 적용**. 선택 즉시 모든 기능(분석·의견·리포트·A/B·설문)이 해당 모델로 전환.

### 부가 기능
- 📁 **파일 업로드** — TXT·PDF·DOCX·HWP·HWPX 자동 텍스트 추출
- 📡 **스트리밍 분석** — SSE로 소구점→점수→의견→리포트 토큰을 단계별 실시간 전송
- 🛡️ **PII 마스킹** — 사용자 자유 입력은 입력 경계에서 마스킹, 응답·로그·영속화에서 제거

---

## 🖥️ 화면(페이지) 안내

| 경로 | 화면 | 설명 |
|------|------|------|
| `/` → `/intro` | 인트로 | 소개 랜딩 (히어로 + 파이프라인 + 4메뉴 CTA) |
| `/analyze` | 상품 분석 | 메인 기능 (새 분석 / 이력 탭) |
| `/abtest` | A/B 테스트 | 두 안 비교 (`?mode=history`로 이력) |
| `/cannibal` | 겹침 분석 | 다중 안 자기잠식 (탭 4종) |
| `/personas` | 페르소나 탐색 | 자연어+필터 검색, 24개씩 페이지 |
| `/surveys` | 설문 | 마법사 4단계 + 이력 |
| `/surveys/[id]/progress·responses·report` | 설문 상세 | 진행·응답·차트 리포트 |
| `/overview` | 데이터 현황 | 100만 행 통계 대시보드 |
| `/history` | 분석 이력 | 지난 분석 다시 보기 |
| `/admind` | 관리자 | LLM provider/모델 전역 설정 |

---

## ⚙️ 작동 원리 (쉽게)

상품 분석을 예로 들면, 입력에서 결과까지 이렇게 흐릅니다.

```
[1] 약관·카피·컨셉 입력 (또는 파일 업로드)
        │
        ▼
[2] LLM이 "소구점·타겟 조건"을 구조화 추출
    (예: 이 상품의 핵심 혜택 / 타겟 연령·성별·가구 / 관심사 가중치)
        │
        ▼
[3] 추출한 핵심 문구를 임베딩(숫자 벡터)으로 변환  ← 캐시 hit이면 0ms
        │
        ▼
[4] 100만 페르소나 임베딩과 코사인 유사도 일괄 계산 (~84ms)
    + 룰 보너스(나이·성별·가구·학력·직업 일치) + 관심사 친화도 결합
        │
        ▼
[5] 0~100점 환산 → 핵심/타겟/관심 코호트로 분할 + 인구통계·지역 집계
        │
        ▼
[6] 상·하위 페르소나가 1인칭 의견 생성(LLM 병렬) + AI 리포트
        │
        ▼
[7] 화면에 카드·차트·지도·리포트로 표시 + 이력 저장
```

**핵심 아이디어**: 사람의 성향을 "숫자 벡터"로 바꿔 두면(임베딩), 상품 문구도 같은 벡터로 바꿔 **방향이 비슷한 사람 = 반응할 사람**으로 찾을 수 있습니다. 여기에 나이·직업 같은 명시 조건(룰)과 관심사 가중치를 더해 최종 점수를 만듭니다.

---

## 🧱 아키텍처

```
┌─────────────────────────────┐         ┌──────────────────────────────────────┐
│  Next.js 14 + TypeScript    │         │  FastAPI (Python 3.12, uv)            │
│  Tailwind (한화 톤)          │         │                                      │
│  Recharts · Kakao 지도       │ ─POST─▶ │  ┌────────────────────────────────┐  │
│                             │ /api/*  │  │ LLM provider (전역 전환)        │  │
│  :5101 (외부 노출)           │         │  │  OpenAI gpt-5.4 (현재 운영)     │  │
└─────────────────────────────┘         │  │  · sLLM(vLLM, OpenAI 호환)      │  │
            │ Next.js rewrites           │  │  · Anthropic Claude (보존)      │  │
            ▼                            │  └────────────────────────────────┘  │
   127.0.0.1:5102 (내부 전용)            │  ┌────────────────────────────────┐  │
                                         │  │ KURE-v1 임베딩 (로컬 GPU, 1024d)│  │
                                         │  │  + 2계층 캐시 (메모리 LRU+디스크)│  │
                                         │  └────────────────────────────────┘  │
                                         │  ┌────────────────────────────────┐  │
                                         │  │ 페르소나 100만 행 (인메모리)     │  │
                                         │  │  parquet 1.6GB + npy 3.9~5.8GB  │  │
                                         │  └────────────────────────────────┘  │
                                         │  이력: JSONL/파일 (외부 DB 없음)       │
                                         └──────────────────────────────────────┘
```

**포트 설계**: 외부에는 **5101(Next.js)** 하나만 노출하고, `/api/*` 요청은 Next.js rewrites가 내부 **5102(FastAPI)** 로 프록시합니다. → CORS·역방향 프록시 별도 설정 불필요, FastAPI는 외부에서 직접 접근 불가.

> **임베딩 모델 전환 주의 (2026-06 진행 중)**: 코드(`config.py`)는 KURE-v1(1024d)을 가리키지만, 운영 npy는 아직 OpenAI `text-embedding-3-small`(1536d, `embeddings_1m_v2.npy`)일 수 있습니다. **임베딩 모델과 저장 npy의 차원이 반드시 일치해야** `embeddings @ query` 연산이 성립합니다. 재시작 전 모델/npy 정합을 확인하세요.

---

## 🧮 점수는 어떻게 매겨지나 (알고리즘)

### 반응도 스코어링 (v3, `services/scoring.py`)

100만 행 전체에 대해 다음을 계산합니다.

```
1) 의미 적합도 (cosine)
   상품 임베딩 · 페르소나 임베딩 내적 → 분석 내 z-score 표준화
   cosine_score = z × SIGMA_T(6.5) + center(제품 매력도 오프셋, 상한 88)

2) 룰 보너스 (rule_bonus, 0~1)
   타겟 차원(연령·성별·가구·학력·직업) 일치도. 명시 차원만 가산, 비일치는 floor.

3) 관심사 친화도 (category_bonus, 0~1)  ← 2026-06-08 개선
   6개 관심사(전문직·스포츠·예술·여행·요리·가정) "개념 벡터"와 페르소나 임베딩의
   코사인을 카테고리별 백분위로 정규화한 친화도 행렬을, 사용자/LLM 가중치로 가중평균.

4) 보험 관심 부스트 (insurance, 통합 데이터 있을 때만)

── 최종 결합 (가산식) ──
raw = cosine_score + W_RULE(14)·(rule−0.5) + W_CAT(7)·(cat−0.5) + W_INSUR(4)·insur
score = clip( soft_ceiling(raw, knee 90), 0, 100 )

── 코호트 분할 (절대 점수 컷) ──
핵심 반응층 ≥ 81 · 타겟층 ≥ 73 · 관심층 ≥ 68
```

**왜 이렇게?**
- **z-score 표준화**: 균등 매핑(v1)은 모든 분석을 똑같은 분포로 만들어 제품 간 매력도 차이를 지웠습니다. v2/v3는 분석 내 종형 분포 + 제품 매력도 오프셋으로 spread를 살립니다.
- **soft-ceiling**: 상위권이 전부 100점으로 포화돼 동률이 되는 천장 문제를 점근 압축으로 해소(v3, 2026-06-04).
- **관심사 친화도(개념 벡터)**: 과거에는 "카테고리 텍스트가 비었나"만 봤는데, 100만 페르소나 전원이 6개 텍스트를 다 채워 신호가 죽어 있었습니다(가중치 무효). 이제 **개념 벡터와의 의미 유사도**를 백분위로 정규화해, 가중치를 올린 관심사에 실제로 강한 페르소나가 위로 올라옵니다. 백분위라 모집단 평균은 그대로(정직한 재분배), 코호트·분포·세그먼트만 반응합니다.

### LLM·임베딩

| 용도 | 모델 |
|------|------|
| 소구점 추출 / 페르소나 의견 / 리포트 / A·B 전략 / 설문 응답 | **멀티 provider** — OpenAI `gpt-5.4`(현재 운영) · sLLM(vLLM, OpenAI 호환) · Anthropic Claude(`claude-sonnet-4-6`/`claude-haiku-4-5`, 보존). 관리자 페이지에서 전역 전환 |
| 임베딩 | **KURE-v1** (nlpai-lab, BAAI/bge-m3 한국어 파인튜닝, 로컬 GPU, 1024d) + 2계층 캐시 |

---

## 🛠️ 기술 스택

**프론트엔드** (`apps/web`)
- Next.js 14.2 (App Router) · React 18 · TypeScript 5
- Tailwind CSS 3.4 (+ `@tailwindcss/typography`) — 한화 디자인 토큰
- Recharts 3 (차트) · topojson-client (지도) · react-markdown (리포트)

**백엔드** (`apps/api`)
- FastAPI 0.115 · uvicorn · Python 3.12 (`uv` 패키지 관리)
- pandas 2 · numpy 2 · pyarrow (100만 행 인메모리)
- sentence-transformers (KURE-v1 로컬 임베딩) · openai · anthropic SDK
- pypdf · python-docx · openpyxl · pyhwp (파일 추출) · tenacity (재시도)
- pytest · ruff (테스트·린트)

**인프라**
- pnpm 모노레포 (workspace) · pm2 프로세스 관리 (`ecosystem.config.cjs`)

---

## 📂 디렉토리 구조

```
ai_hack/
├── apps/
│   ├── web/                          # Next.js 14 App Router
│   │   ├── app/
│   │   │   ├── intro/                # 소개 랜딩 (/ → /intro)
│   │   │   ├── analyze/              # 상품 분석 (메인)
│   │   │   ├── abtest/               # A/B 테스트 (+ ?mode=history)
│   │   │   ├── cannibal/             # 겹침 분석
│   │   │   ├── personas/             # 페르소나 탐색
│   │   │   ├── surveys/              # 설문 마법사 + 이력 + [id]/{progress,responses,report}
│   │   │   ├── overview/             # 데이터 현황 대시보드
│   │   │   ├── history/              # 분석 이력
│   │   │   └── admind/               # 관리자 LLM 설정
│   │   ├── components/               # 분석/리포트/차트/지도 + abtest/ + cannibal/ + wizard/
│   │   │   ├── WhatIfLab.tsx         #   What-if 실험실
│   │   │   ├── ScoreDriverWaterfall.tsx  #   점수 DNA 워터폴
│   │   │   ├── KoreaMap.tsx          #   Kakao 지역 지도
│   │   │   ├── SegmentDiscoveryPanel.tsx  #   숨은 세그먼트
│   │   │   ├── abtest/               #   OverlapVenn · SplitPlaybook · SwingLayerXray …
│   │   │   ├── cannibal/             #   CannibalMatrix · Coverage · Exclusive …
│   │   │   └── wizard/               #   설문 마법사 4단계
│   │   └── lib/
│   │       ├── api.ts                #   FastAPI 호출 클라이언트 + 타입
│   │       ├── chartColors.ts        #   차트 팔레트(10색)
│   │       └── markdown.ts           #   LLM 마크다운 정규화(한글 볼드 보정)
│   └── api/                          # FastAPI (Python 3.12, uv)
│       ├── main.py                   # 진입점 + 라우터 등록 + store/임베딩 사전 로드
│       ├── routes/                   # analyze · analyze_stream · whatif · abtest(s)
│       │                             #   · cannibal(s) · dataset · surveys · survey_* · segments · admin · extract · products
│       ├── services/                 # store · scoring · persona_search · persona_filter
│       │                             #   · query_normalization · cannibalization · segment_discovery
│       │                             #   · opinions · simulation · comparison · abtest_llm
│       │                             #   · survey_run · survey_engine · commentary · pii_mask · text_extractor
│       │   └── llm/                  #   config · provider · embedding(KURE) · clients · service · schemas
│       ├── prompts/                  # LLM 시스템 프롬프트 (.md) + prompts/openai/ (전용)
│       ├── models/                   # schemas.py(분석) · survey.py(설문)
│       └── tests/                    # pytest 회귀 테스트
├── scripts/
│   ├── sample_personas.py            # 100만 행 stratified 샘플링
│   ├── embed_personas.py             # 임베딩 batch 생성 (combined)
│   ├── validate_known_targets.py     # Known-target 백테스트
│   └── backfill_commentaries.py      # 설문 총평 backfill
├── data/                             # (gitignored)
│   ├── personas_1m.parquet           # 1.6GB — 100만 행 메타 + 페르소나 텍스트
│   ├── embeddings_1m_v2.npy          # 5.8GB — OpenAI 임베딩(1536d, 현재 운영)
│   ├── embeddings_1m_kure.npy        # 3.9GB — KURE 임베딩(1024d, 전환 중)
│   ├── analyses.jsonl / abtests.jsonl / cannibals.jsonl / simulations.jsonl
│   ├── surveys/ · segments/          # 설문·세그먼트 영속화
│   ├── answer_cache/ · embed_cache/  # LLM 응답·임베딩 캐시 (sha256 샤딩)
│   └── llm_config.json               # 전역 LLM provider/모델 (관리자 페이지가 갱신)
├── docs/                             # 샘플 약관 · 검증 리포트
├── agent-guide/                      # AI 에이전트 가이드 (GUIDE/PROJECT/SESSION)
└── ecosystem.config.cjs              # pm2 설정 (web 5101 / api 5102)
```

---

## 🔌 API 엔드포인트

> 모두 `/api` 접두. FastAPI는 내부(127.0.0.1:5102) 전용이며 Next.js rewrites로만 접근.

**분석**
- `POST /api/analyze` — 상품 분석 (blocking)
- `POST /api/analyze/stream` — 분석 SSE 스트리밍 (소구점→점수→의견→리포트 토큰)
- `POST /api/whatif` — 기 분석 재점수 (타겟/가중치 override, 임베딩 0콜)
- `GET·DELETE /api/analyses[/{id}]` — 분석 이력 조회·삭제

**A/B · 겹침**
- `POST /api/abtest` · `GET·DELETE /api/abtests[/{id}]` — A/B 분석·이력
- `POST /api/cannibal` · `GET·DELETE /api/cannibals[/{id}]` — 겹침 분석·이력

**페르소나·데이터셋**
- `GET /api/dataset/overview` — 데이터셋 전체 통계
- `POST /api/dataset/personas/search` — 자연어 시멘틱 검색
- `POST /api/dataset/personas/filter` — 메타 필터 + 페이지네이션
- `GET /api/dataset/personas/facets` — 필터 UI용 distinct 값
- `GET /api/dataset/personas/{uuid}` — 페르소나 상세

**설문**
- `POST·GET·PUT·DELETE /api/surveys[/{id}]` — 설문 CRUD
- `POST /api/surveys/{id}/run` · `GET /api/surveys/{id}/status` — 실행·진행
- `GET /api/surveys/{id}/recent-answers` · `POST /api/surveys/{id}/retry-failed`
- `GET /api/surveys/{id}/responses · report · report.csv` — 응답·리포트
- `POST /api/surveys/suggest-questions` · `POST /api/surveys/questions/parse-file` — AI 추천·임포트
- `GET /api/surveys/sllm-model` — 현재 sLLM 모델명(SSOT)

**기타**
- `POST /api/simulate` — 페르소나 가상 응답
- `POST·GET·DELETE /api/segments[/{id}]` — 세그먼트 CRUD
- `POST /api/extract-text` — 파일 텍스트 추출
- `GET /api/products[/{id}/body]` — 약관 카탈로그
- `GET·POST /api/admin/llm-config` — 전역 LLM 설정 (X-Admin-Token)
- `GET /health` — 헬스체크

---

## 🚀 Quickstart (설치·실행)

### 사전 조건

| 항목 | 버전 |
|------|------|
| Node | 20+ |
| pnpm | 11+ |
| Python | 3.12+ |
| uv | 0.11+ |
| GPU | KURE-v1 로컬 임베딩 추론용 (CPU 폴백 가능, 느림) |
| API 키 | provider에 따라 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `SLLM_BASE_URL` |

### 1) 의존성 설치

```bash
pnpm install                      # 프론트 (워크스페이스)
cd apps/api && uv sync && cd ../..  # 백엔드
```

### 2) 환경변수

```bash
cp .env.example .env
# 편집 예시:
#   OPENAI_API_KEY=sk-...                       # OpenAI provider 사용 시
#   ANTHROPIC_API_KEY=sk-ant-...                # Anthropic provider 사용 시
#   SLLM_BASE_URL=http://localhost:5015/v1      # sLLM(vLLM) 엔드포인트
#   EMBED_DEVICE=cuda                           # KURE 임베딩 디바이스 (빈 값=자동)
#   NEXT_PUBLIC_KAKAO_MAP_APPKEY=...            # (선택) 시군구 지도
```
> 전역 provider/모델은 `data/llm_config.json` 또는 관리자 페이지(`/admind`)로 제어합니다.

### 3) 데이터 적재 (1회)

이미 `data/personas_1m.parquet` + 임베딩 npy가 있으면 생략.

```bash
python scripts/sample_personas.py   # 100만 행 stratified 샘플 → personas_1m.parquet
python scripts/embed_personas.py    # 임베딩 batch → embeddings npy
```

### 4) 실행 (pm2 권장)

```bash
pnpm --filter web build             # Next.js 프로덕션 빌드 (1회)
pm2 start ecosystem.config.cjs      # web(5101) + api(5102) 등록·시작
pm2 logs personafit-api             # 로그 확인
```
브라우저로 **http://localhost:5101** 접속.

> API 부팅 시 100만 행 store(~17초) + KURE 임베딩 모델(~28초) 사전 로드.

### 4-alt) 개발 모드

```bash
cd apps/api && uv run uvicorn main:app --reload --port 5102   # 터미널 1
pnpm --filter web dev                                         # 터미널 2 (http://localhost:3000)
```

### 부팅 검증

```bash
curl http://localhost:5101              # → HTTP 200
curl http://localhost:5102/health       # → {"ok":true,"service":"personafit-api"}
```

---

## 🔬 모델 검증

PersonaFit은 **Known-target 백테스트**로 "모델이 명시적 타겟을 일관되게 잡는가"를 정량 측정합니다.

- 정답이 명시된 보험 약관 **11종** (여성전용·시니어·유자녀·청년·전문직·미혼1인·은퇴자·남성전용·**군인**·**제주도**·**간호사**)
- 케이스별 성별·연령·가구·학력·직업·지역·군복무 분포 비율 자동 체크

| 지표 | 값 |
|------|-----|
| 케이스 통과 | **11 / 11 (100%)** |
| 체크 통과 | **22 / 22 (100%)** |

> 인사이트 예: 군인 케이스는 `military_status` 필드가 스키마에 없는데도 **90% 현역** 매칭(직업 "병사/장교" 부분 매칭). 제주 케이스는 인구 1.4% 지역이 상위 20명 중 **50%(36배 over-representation)** — 임베딩이 "감귤·해녀" 키워드로 간접 매칭.

### 검증의 한계 (정직하게)
이 검증은 **타겟 일관성**만 측정합니다. 다음은 별도 검증 필요:
- 합성 페르소나가 실제 한국인을 얼마나 닮았는가
- 추천 페르소나가 **실제로** 가입할 확률 / 캠페인 실제 전환율

```bash
python scripts/validate_known_targets.py   # → docs/VALIDATION.md
```

---

## ⚡ 성능·비용

| 단계 | 소요 |
|------|------|
| 소구점 추출 (LLM tool_use) | 7~9초 |
| 임베딩 (캐시 hit / miss) | <1ms / 0.5~1.5초 |
| 100만 행 brute-force 코사인 | ~84ms |
| 리포트 생성 (LLM) | 11~12초 |
| **분석 전체** | **약 19~25초** |
| What-if 재점수 (임베딩 0콜) | 수십 ms |

- **메모리**: API 프로세스 RSS ~13.5GB (임베딩 npy mmap + 정규화 DataFrame + 캐시)
- **비용**: 임베딩은 **로컬 KURE-v1**(외부 API 비용 0). LLM은 선택 provider 과금. 캐시 hit 시 추가 비용 0.

---

## 🎨 UI 디자인 정책 (한화 톤)

- **구조색**: `vellum`(배경)·`snow`(카드)·`onyx`(어두운 CTA)·`parchment`(경계)·`graphite`/`dusty`/`stone`(텍스트)
- **브랜드색**: `terra`(주황, 주 브랜드 / B안)·`marine`(파랑, 비교 / A안)·`azure`(밝은 파랑, 정보)
- **시맨틱색**: `success`/`warning`/`danger`/`info`
- **차트/지도**: `CHART_PALETTE` 10색(muted) — `lib/chartColors`
- **금지**: Tailwind 기본 컬러(rose/emerald/indigo 등) 직접 사용, 장식용 이모지·AI틱 좌측 강조선
- **폰트**: SUITE Variable (본문) · AtoZ

---

## 🛠️ 운영 메모

- **pm2**: `autorestart` + `max_memory_restart`(api 60G / web 4G). 단, restart만으론 고아 프로세스가 포트를 점유할 수 있어 라이브 스키마 교차검증 권장.
- **Cloudflare Tunnel**: `persona.smap.site`는 `/home/jin/.cloudflared/config.yml`에서 `http://127.0.0.1:5101`로 연결합니다. FastAPI는 계속 `127.0.0.1:5102` 내부 전용이며 Next.js rewrites만 호출합니다.
- **임베딩 npy 정합**: 임베딩 모델 차원과 운영 npy 차원이 일치해야 함(KURE 1024d ↔ `embeddings_1m_kure.npy`, OpenAI 1536d ↔ `embeddings_1m_v2.npy`). `ecosystem.config.cjs`의 `PERSONAS_NPY` + `config.py`의 `EMBED_MODEL`을 함께 맞춰 재시작.
- **캐시**: 임베딩(`embed_cache/`)·LLM 응답(`answer_cache/`)을 sha256 샤딩 영속화. 임베딩 캐시는 retention 정책으로 자동 정리.
- **이력**: 모든 결과를 JSONL/파일로 영속화 (외부 DB 미도입).

---

## 📖 용어 사전

| 용어 | 쉬운 설명 |
|------|-----------|
| **페르소나** | 가상의 한국인 한 명. 나이·직업·가족·관심사 등이 있는 합성 프로필 |
| **소구점** | 상품이 내세우는 핵심 매력 포인트. LLM이 약관/카피에서 자동 추출 |
| **임베딩** | 텍스트(사람·상품)를 의미를 담은 숫자 벡터로 바꾼 것. 방향이 비슷하면 의미가 비슷 |
| **코사인 유사도** | 두 벡터가 얼마나 같은 방향인지(=의미가 얼마나 비슷한지) |
| **코호트** | 점수대로 묶은 집단. 핵심 반응층(≥81) / 타겟층(≥73) / 관심층(≥68) |
| **baseline-lift** | 어떤 그룹이 전체 모집단 대비 몇 배 더(또는 덜) 모였는지 (과대/과소 표집 배수) |
| **자기잠식(cannibalization)** | 여러 안이 같은 사람들을 두고 서로 반응층을 갉아먹는 정도 |
| **What-if** | 조건을 바꿔 가며 "이러면 어떻게 될까"를 즉석에서 보는 시뮬레이션 |
| **sLLM** | 사내 자체 호스팅 LLM(vLLM, OpenAI 호환 API) |

---

## 📚 데이터 출처·라이선스

**데이터**: [`nvidia/Nemotron-Personas-Korea`](https://huggingface.co/datasets/nvidia/Nemotron-Personas-Korea)
- 라이선스 **CC BY 4.0** (상업적 이용 가능) · 100만 합성 한국인 페르소나
- 컬럼: 페르소나 텍스트 7종(`persona` + 전문직/스포츠/예술/여행/요리/가정) + 인구통계(성별·연령·혼인·가구·학력·전공·직업) + 지역(17 시도 · 252 시군구)
- 생성: NVIDIA NeMo Data Designer, KOSIS·대법원·국민건강보험공단·KREI 통계 기반

> 본 프로젝트의 모든 분석은 **합성 페르소나** 기준이며 실제 인물·데이터와 무관합니다.

**라이선스**
- 코드: MIT (또는 팀 정책)
- 데이터: CC BY 4.0 (NVIDIA)
- 임베딩: KURE-v1 (MIT) · LLM: 각 provider 약관

---

## 🤝 기여 가이드

`agent-guide/` 문서를 먼저 확인하세요.
- [`GUIDE.md`](agent-guide/GUIDE.md) — 작업 원칙·도메인 용어·MCP 도구
- [`PROJECT.md`](agent-guide/PROJECT.md) — 구조·기술 스택·핵심 파일
- [`SESSION.md`](agent-guide/SESSION.md) — 현재 상태·다음 작업 큐
