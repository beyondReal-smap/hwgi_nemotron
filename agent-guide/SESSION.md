---
name: session
description: 프로젝트 현재 상태. 세션 시작 시 현재 상태 파악용.
last-updated: 2026-05-25
---

# 세션 상태

> 세션 시작 시 현재 상태를 빠르게 파악하기 위한 문서

---

## 작업 관리

| 항목 | 내용 |
|------|------|
| **작업 관리 도구** | [TODO: 도구 선정 후 링크 추가] |

---

## 다음 작업

| 우선순위 | 작업 | 상태 |
|---------|------|------|
| P0 | MVP 아키텍처 계획서 작성 | ✅ Done |
| P0 | part1 — 모노레포 + 10만 행 stratified + 임베딩 (parquet 93MB + npy 586MB) | ✅ Done |
| P0 | part2 — Sonnet 소구점 추출 + 인메모리 스코어링 + FastAPI POST /api/analyze | ✅ Done |
| P0 | part3 Phase 4 — Next.js UI (InputForm/ScoreCard/PersonaList/RegionChart/ReportPanel) | ✅ Done |
| P0 | E2E 검증 — 3종 약관 (여행/어린이/종신) 분석 + pm2 등록 (5101) | ✅ Done |
| P0 | **파일 업로드 기능** — TXT/PDF/DOCX/HWP/HWPX 자동 텍스트 추출 | ✅ Done |
| P0 | **임베딩 쿼리 캐시** — 메모리 LRU 4096 + 디스크 .npy + per-key lock (2026-05-22 도입) | ✅ Done |
| P0 | **100만 행 v2 임베딩 전환** — embeddings_1m_v2.npy 활성, v1 archive (2026-05-22) | ✅ Done |
| P1 | **UI 시각적 폴리시** — /abtest 한화 톤 9건 + AlertModal 1건 통일, 통계 강조(text-heading+num-tabular), 상태 표시 강화 | ✅ Done (2026-05-25) |
| P1 | **apps/web 전역 한화 톤 검사** — 모든 페이지·컴포넌트 비한화 톤 0건 확인 | ✅ Done (2026-05-25) |
| P1 | 종합 검증 (work-verify) | ✅ Done (2026-05-25) |
| P0 | **100만 행 통합 임베딩 batch** — combined 모드(7종 페르소나 + 3종 속성), `embeddings_1m_v2.npy` 5.8GB 운영 중 | ✅ Done (2026-05-21) |
| P2 | 5.8GB 임베딩 파일 외부 공개 (HuggingFace fork 또는 GitHub Releases split) | Todo (선택) |

---

## 확정 사항

- **샘플 크기**: 개발·데모 10만 행 / 제출·운영 100만 행 (`embeddings_1m_v2.npy` 5.8GB)
- **LLM 모델**: 소구점 추출 = `claude-sonnet-4-6`, 리포트 = `claude-haiku-4-5`, 임베딩 = `text-embedding-3-small`
- **배포**: 로컬 데모 한정 (Vercel/Fly.io는 v2)
- **운영**: pm2 (`personafit-web` 5101 외부 / `personafit-api` 5102 내부)
- **DB 전략**: 인메모리(parquet + numpy mmap) — brute-force 100만 행 ~84ms. 영속화는 JSONL/디렉토리 파일 기반 영구 사용 (외부 DB 미도입)
- **임베딩 캐시**: `services/embed_cache.py` (2계층 — 메모리 LRU 4096 + 디스크 `data/embed_cache/{sha:2}/{sha}.npy`) + `services/llm.py:embed_text`에 WeakValueDictionary per-key lock으로 동시 miss 중복 OpenAI 호출 차단
- **LLM 호출 정책**: sLLM(Qwen) 단일 호출. Anthropic Claude SDK·구현체 코드는 보존하되 5곳(get_llm_service / opinions._call_llm_sync / simulation._call_llm_sync / abtest_llm 2곳 / commentary.generate_and_persist) 진입부 `provider = "sllm"` 강제. Frontend 토글 UI 모두 제거 (InputForm·SurveyPanel·ABTestInputForm·wizard/StepExecution).
- **UI 디자인 정책**: 한화 톤(`vellum/ink/onyx/graphite/dusty/stone/parchment/snow/azure/terra`)만 사용. Tailwind 기본 컬러(rose/emerald/amber/indigo 등) 사용 금지. 의미 매핑은 `internal/긍정/안정 = azure`, `external/부정/주의 = terra`, `경고 옅게 = terra/8` 패턴 유지.
- **롤백 안전망**: v1 임베딩은 `data/.archive/2026-05-22_v1-npy/embeddings_1m.npy`에 5.8GB 보존. ecosystem.config.cjs 환경변수 PERSONAS_NPY 변경으로 즉시 복귀 가능.

---

## 가동 중인 서비스

- 🌐 http://localhost:5101 (Next.js, 외부 접근)
- ⚙️ http://127.0.0.1:5102 (FastAPI, 내부, Next.js rewrites 프록시)
- `pm2 list` / `pm2 logs personafit-web` / `pm2 restart personafit-*`
- **메모리**: API 프로세스 ~13.5GB (npy 5.7GB mmap + parquet 1GB + 카테고리화된 DataFrame + 임베딩 캐시 LRU ≈24MB)
- **임베딩 캐시 디렉토리**: `data/embed_cache/` — 운영 중 자동 누적, `.gitignore`로 git 추적 차단

## E2E 측정 결과 (3종 보험)

| 상품 | 1순위 카테고리 | 평균 점수 | 합계 시간 |
|------|---------------|----------|----------|
| 어린이보험 | family 0.70 | 67-69 | 22.5s |
| 여행자보험 | travel 0.55 | 75-77 | 18.9s |
| 종신보험 | family 0.55 + professional 0.25 | 79-81 | 24.9s |

---

## 데이터셋 탐색 요약 (2026-05-20)

- **규모**: 100만 행, **라이선스 CC BY 4.0** (상업적 이용 가능 ✅)
- **컬럼 26개**: 페르소나 7종(`persona` + 6개 카테고리) + 속성 6종 + 인구통계·지역 13종
- **지역**: `province` 17개 / `district` 252개 시군구
- **페르소나 카테고리 분리**가 큰 이점 — 상품 유형별로 가중 매칭 가능 (여행보험→travel, 종신→family 등)
- **샘플 분포**: 평균 49.5세, 무직 33%, 경기/서울 46% (실제 한국 인구통계 반영)
- **저장된 샘플**: `scripts/sample_personas.json` (첫 3행)

---

## 기타 이슈

- **API 키 확보**: Anthropic, OpenAI 자격증명 필요 (sLLM 사용 시 SLLM_BASE_URL/SLLM_MODEL)
- **호스팅 결정**: 해커톤 일정에 맞춰 Vercel + Fly.io 등 빠른 배포 옵션 검토
- **임베딩 비용**: 10만 행 × 1536차원 임베딩 시 OpenAI 비용 ~$2 수준 (text-embedding-3-small $0.02/1M token 가정)
- **occupation 정규화 검토**: 자유텍스트 → KSCO 한국표준직업분류 매핑이 필요할지 v2에서 결정

---

## 최근 세션

### 2026-05-25

#### 세션 목표
- 임베딩 쿼리 캐싱 도입 + 100만 행 v2 npy 전환
- /abtest 페이지 한화 톤 폴리시 + 통계 강조
- apps/web 전역 비한화 톤 통일

#### 변경 파일
| 파일 | 변경 유형 | 요약 |
|------|----------|------|
| `apps/api/services/embed_cache.py` | 신규 | 2계층 캐시 (메모리 LRU 4096 + 디스크 .npy 샤딩 + atomic write) |
| `apps/api/services/llm.py` | 수정 | `embed_text`를 캐싱 wrapper로 (시그니처 `list[float]` 유지) + WeakValueDictionary 기반 per-key lock으로 동시 miss 중복 호출 차단 |
| `apps/api/services/store.py` | 수정 | `DEFAULT_NPY`를 `embeddings_1m_v2.npy`로 (환경변수 fallback과 일치) |
| `ecosystem.config.cjs` | 수정 | 롤백 절차 주석 갱신 (archive 경로 명시) |
| `.gitignore` | 수정 | `data/embed_cache/`, `data/answer_cache/`, `*.npy` 추가 |
| `data/embeddings_1m.npy` | 이동 | → `data/.archive/2026-05-22_v1-npy/` (5.8GB 롤백 보존) |
| `apps/web/app/abtest/page.tsx` | 수정 | 에러 배너 한화화 + 로딩 spinner 강화 |
| `apps/web/components/abtest/ABTestHistoryList.tsx` | 수정 | 에러·삭제 hover 한화화 + 로딩 skeleton 카드화 |
| `apps/web/components/abtest/ABTestResultPanel.tsx` | 수정 | OpinionRow sentiment 한화화 + Stat 통계 강조 (text-heading + num-tabular + 단위 분리) |
| `apps/web/components/abtest/ABTestInputForm.tsx` | 수정 | 글자 카운터·경고 4곳 한화화 |
| `apps/web/components/AlertModal.tsx` | 수정 | warning tone amber → terra/8 + terra/25 |

#### 결정 사항
- **HNSW 도입 보류**: `scoring.py:score_all_personas`가 전체 100만 행 cohort percentile 통계를 산출해야 하므로 ANN 인덱스 적용 불가. brute-force ~84ms로 충분. 메모리 mmap_mode + 임베딩 캐싱이 ROI 우선.
- **임베딩 캐시 인터페이스**: 시그니처 `list[float]` 유지하여 호출자 3곳(`analyze.py:45`, `persona_search.py:55`, `dataset.py:346`) 무수정. 캐시 hit 시 `.tolist()` 변환은 1536 element ~10us 수준이라 무시.
- **한화 톤 일관화 매핑**: `internal/긍정 = azure/25-30 + ink`, `external/부정/에러 = terra/10-15 + terra`, `옅은 경고 = terra/8 + terra/25`. 다른 의미 신규 추가 시 이 매핑 우선 재사용.
- **AlertModal warning**: 호출자 0건이나 미래 사용 대비 한화화. danger와는 농도(15 vs 8/25)로 시각 구분.

#### 측정 결과
| 시나리오 | embed 시간 | total | 비고 |
|---------|-----------|-------|------|
| Cache miss (cold OpenAI) | 120~1780ms | 800~2200ms | API 호출 |
| Cache hit (memory LRU) | **0ms** | 339ms | search 동일 |
| Cache hit (disk) | <1ms | 약 340ms | 메모리 promote |
| 동시 동일 query 5회 | OpenAI **1회만** | — | per-key lock 검증 (디스크 캐시 파일 1개만 추가됨) |

#### 검증
- TypeScript 타입 체크 (apps/web) exit 0
- apps/web 전역 비한화 톤 grep 0건
- pm2 restart 후 5개 핵심 페이지(`/`, `/abtest`, `/personas`, `/surveys`, `/overview`) HTTP 200

#### 현재 상태
- 임베딩 캐시 + v2 npy + UI 한화화 완료, production 빌드·재기동 반영 완료
- 다음 후보: 5.8GB 임베딩 파일 외부 공개(HuggingFace fork 또는 GitHub Releases split) · GUIDE.md 정합 점검 · agent-guide/plans/ 과거 Supabase 언급 archive · ruff 잔존 B008/B023/E402 본격 처리

---

### 2026-05-20

#### 세션 목표
- 프로젝트 초기화: agent-guide 3종 파일 생성

#### 변경 파일
| 파일 | 변경 유형 | 요약 |
|------|----------|------|
| `agent-guide/GUIDE.md` | 추가 | 작업 원칙, 세션 체크리스트, 도메인 용어(페르소나/반응도/FP 등) |
| `agent-guide/PROJECT.md` | 추가 | PersonaFit 개요, 기술 스택, 데이터 흐름 |
| `agent-guide/SESSION.md` | 추가 | 세션 상태 초기화, MVP 작업 큐 정의 |

#### 결정 사항
- 프로젝트명: **PersonaFit**
- 스택 확정: Next.js + Tailwind · FastAPI · Supabase · Anthropic/OpenAI · `nvidia/Nemotron-Personas-Korea`
- MVP 5개 기능 범위 확정 (상품 입력 → 소구점 분석 → 페르소나 매칭 → 지역 분포 → 리포트)

#### 현재 상태
- 프로젝트 초기화 완료, 첫 구현 작업(데이터셋 탐색 + 모노레포 스캐폴딩) 대기
