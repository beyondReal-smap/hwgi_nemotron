---
name: session
description: 프로젝트 현재 상태. 세션 시작 시 현재 상태 파악용.
last-updated: 2026-06-03
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
| P1 | **성능 최적화 + 구조 리팩토링** — score 22%↓(category 부팅캐시·percentile 단일정렬), api.ts −187줄(_jsonRequest), KoreaMap dynamic, JSONL 공통 `fileio.py`, provider 6곳→`enforce_provider` 중앙화 | ✅ Done (2026-05-30) |
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
- **LLM 호출 정책**: sLLM(Qwen) 단일 호출. Anthropic Claude SDK·구현체 코드는 보존하되 호출 차단. **2026-05-30: 흩어져 있던 6곳의 `provider = "sllm"` 하드코딩을 `llm.enforce_provider()` 단일 헬퍼로 중앙화** — get_llm_service / opinions / simulation / abtest_llm 2곳 / commentary가 모두 `provider = enforce_provider(provider)` 호출. **Anthropic 복귀 시 이 함수만 `return requested`로 바꾸면 전체 해제**. Frontend 토글 UI 모두 제거 (InputForm·SurveyPanel·ABTestInputForm·wizard/StepExecution).
- **임베딩 정규화 (2026-05-30 실측 확정)**: `embeddings_1m_v2.npy`는 이미 L2 정규화됨(norm 0.9994~1.0005, OpenAI `text-embedding-3-small` 반환 벡터). 따라서 `scoring.score_all_personas`의 dot-only 코사인이 정확하고, 런타임/부팅 norm 재정규화는 불필요. `cosine_topk`의 후보별 norm 나눗셈은 제거하여 `score_all`과 동일 처리로 통일.
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

### 2026-06-08 — 와우 고도화 v2 (5대 묶음 풀 구현·배포)

#### 세션 목표
- 대표님 "미쳤다 수준 고도화" 요청 → 16에이전트 발굴 워크플로우(44아이디어) → 4묶음+SSE 전부 구현·배포.

#### 구현 (5대 묶음)
| 묶음 | 기능 | 핵심 |
|------|------|------|
| 🔬 유리상자 | Score DNA 워터폴·신뢰구간 | `scoring.py` 가산식 항분해(core vs pop delta), 해석적 CI+컷민감도. LLM 0콜 |
| 👤 숫자→사람 | 세그먼트 발굴·VOC 이탈사유 | `segment_discovery.py` 신설(버려지던 cohort_indices 교차 lift), `ObjectionPanel` bottom_opinions 전면화 |
| 🎯 처방 | 스윙층 X-레이·줄다리기·Split Playbook·승패도트 | `comparison.build_overlap_breakdown`(intersect/setdiff+`_build_demographics` 재사용) |
| 🎛️ 손끝탐색 | What-if 실험실 | `whatif.py`(selling_points override→embed 캐시hit 0ms→재점수 2.3초), `WhatIfLab` 슬라이더 |
| ⚡ SSE | 분석 스트리밍 | `analyze_stream.py`(첫결과 3초), `analyzeProductStream`+InputForm partial 렌더+fallback |

- 백엔드 신규: segment_discovery·whatif·analyze_stream / 수정: scoring(all_scores 반환·8tuple)·comparison·analyze·abtest·schemas·main
- 프론트 신규 7: ScoreDriverWaterfall·SegmentDiscoveryPanel·ObjectionPanel·WhatIfLab·SwingLayerXray·SplitPlaybook(+ReportSkeleton) / 수정: ABTestResultPanel·analyze/page·InputForm·lib/api

#### 검증·배포
- 100k 단위검증(가산식 항합=점수 정합, 컷민감도 단조, 3층분할 합 정합) + tsc·ruff·next build·schema:sync 통과
- 배포: 백엔드 pm2 restart personafit-api(이 서버) + 프론트 tar→build→pm2 restart personafit-web(smap-v1)
- **라이브 검증**: Score DNA delta+15.47, 세그먼트 lift 7.31배, What-if 2.3초, A/B 스윙 a_lean 75%, SSE 경유 첫결과 3초(nginx+next rewrites 버퍼링 통과 실증)

#### 후속 4종 (대표님 "남은 부분 수정" 요청)
- **① 리포트 토큰 스트리밍**: `stream_report`(BaseLLMService 기본구현+SLLMService `stream=True` 오버라이드, `__init__` wrapper, analyze_stream `report_token` yield, InputForm 누적+120ms 스로틀) 구현. ⚠️ **실측: gemma-4-31B-it 게이트웨이가 `stream=True` 무시·단일청크 반환**(delta chunks=1) → 타이핑 효과 현재 비활성, graceful(1청크 정상표시). 게이트웨이 업글/OpenAI provider 시 코드변경 없이 자동 활성.
- **② 분석 코파일럿**: `NextActionsPanel`(분석 결과로 다음분석 제안카드 3종, LLM 0콜 클라이언트규칙) + `personas/page` `?q=` 프리필(원클릭 자동탐색). SurveyCta 흡수.
- **③ polish**: verifier 적대점검 P1 3건 수정 — SwingLayerXray 박빙모순(delta≈0 tie분기)·ScoreDriverWaterfall 음수delta 내러티브·WhatIfLab LLM가중치 0~1 클램프. +ObjectionPanel 죽은 이중sort 제거. 재배포(API재시작+smap-v1).

#### 커밋·push (완료)
- **의미 단위 9커밋 → origin/main push 완료**(`beyondReal-smap/hwgi_nemotron`, `beaa922..00b3357`).
  - 와우 v2: `91fe891`(api) `76f5923`(web)
  - 이전 보류분 7: `c002fad`겹침 / `7a3d133`멀티provider+admin / `d38af32`탐색 / `2d4dc61`설문 / `7ae5f51`UI wow+랜딩 / `a4b7570`data / `00b3357`docs+gitignore
- 혼재파일(scoring/schemas/store 등)은 파일단위라 주의미 커밋에 귀속+메시지 명시. 산출물(`.claude/`·`.collab-loop/`)은 gitignore 처리(커밋 제외). push 대상 11(직전 미push 2 포함).

#### 미확인·보류
- 프론트 점진렌더 육안(playwright 불가 — 코드+빌드청크 검증 대체, 육안은 대표님)
- SSE 리포트 토큰 타이핑(게이트웨이 한계로 대기), 코파일럿 Phase2+(승인형 연쇄) 후속 후보

### 2026-06-03

#### 세션 목표
- 직전 세션에서 **중단된 백엔드 대규모 리팩토링**(5-30 커밋 이후 미커밋·미검증·런타임 미반영)을 이어받아 완성·검증·반영.

#### 끊긴 리팩토링의 정체
- 디스크엔 반영돼 import/tsc/build는 통과하나 검증·런타임 반영·커밋 안 된 상태였음. 내용: `fileio.py` 공통화, `dataset.py`→`persona_filter.py` 추출(537줄), `llm.py`(1467)→`llm/` 패키지(7파일), scoring/store 수치 개편, survey 기능 확장, products catalog→`insurance/` 스캔 전환, `query_normalization.py` 신설. (프론트 `/intro`·`/analyze` 분리, 색/배지 확장은 오전에 이미 완료 — 끊긴 건 오후 백엔드.)

#### 진단 방식
- 6차원(영속화·persona_filter·scoring/store·survey·llm패키지·products횡단) 다중 에이전트 적대 진단 + 발견별 적대 재검증. **17건 발견 → 15건 확정 / 2건 거짓양성 기각**(survey_run B023 오탐, survey_report CSV 구분자는 의도된 개선).

#### 수정 (검증 통과)
| 심각도 | 항목 | 파일 | 요약 |
|--------|------|------|------|
| **P0** | SLLM_BASE_URL 미설정 회귀 | `.env`, `.env.example` | 리팩토링이 config 기본값을 운영IP→localhost로 바꿨으나 `.env` 미동기화 → 재기동 시 전 LLM 기능이 죽은 localhost:5015로 향해 실패(잠복형). 옛 호스트 `3.38.195.121:5015`를 `.env`에 복원, example 주석을 config와 동기화 |
| **P1** | 캐시 오염 | `routes/analyses.py` | `get_analysis`가 반환하는 파싱캐시 공유객체를 `detail_endpoint`가 in-place 변형 → 얕은 복사(`{**cached}`)로 격리 |
| **P1** | 전북 정규화 누락 | `services/store.py` | `_PROVINCE_SHORT_MAP`에 `'전라북':'전북'` 추가('전라북도' 입력이 0매칭되던 silent zero-match 수정) |
| **P1/P2** | family_types 절반 연결 | `llm/service.py`·`persona_filter.py`·`query_normalization.py` | `normalize_extracted_filter`(`family_types_for_has_children`로 대체된 구로직)의 family_types 출력이 어디서도 소비 안 됨(dead)+persona_filter 이중적용 → 함수·wrap·import 제거, 단일 경로화 |
| **P2** | fail-fast 반쪽 적용 | `services/survey_repo.py` | `_read_index`만 무음 `return {}` → 자매 `segment_repo`와 동일하게 `logger.exception`+`raise`(손상 시 전체 설문 무음 소실 방지) |
| **P2** | dead 분기 | `web/HwgiProductPicker.tsx` | catalog→insurance 전환으로 도달불가가 된 `body_available` 분기 + 폐기경로(`data/products/pdfs/`) 안내 제거 |

#### 보류 (무해/범위 — 기록만)
- get_analysis 중복id first→last(uuid라 실질 0), `_load_cached` TOCTOU(self-healing 무해), `cosine_topk` dead 함수(호출처 0), lazy 캐시 동시 초기화(GIL·idempotent 무해), `survey_run` PROGRESS_FLUSH 주석 불일치(미커밋 대상 아닌 기존 stale 주석), products `page_url` 잔존 필드(스키마 호환).

#### 검증
- 백엔드 `import main` OK, ruff(변경 6파일) All passed, 프론트 `tsc` 0 · `next build` EXIT 0
- 실측 정합: `전라북도→전북`, family_types(`True=11`/동거`=37`/단서없음`=0`/혼자`=0`)
- pm2 재기동(API+Web 200, 2s) → 분석 detail 캐시 2회 호출 정상, 핵심 6페이지(intro/analyze/personas/surveys/abtest/overview) 200
- **자연어 검색 sLLM 실호출 200(10.8s)**: `provinces=[서울]`·family_types 37(동거 단서)·match 15 — family_types 정리 후 **회귀 없음** + P0 `.env` 복원 동시 검증

#### 현재 상태
- 끊긴 리팩토링 완성·검증·런타임 반영 완료. **커밋은 사용자 요청으로 보류**(미커밋 77+파일 — 5-31~6-02 금융 롤백/scoring v2/intro/색확장 포함).
- ⚠️ 검증 중 자연어 검색 1회 호출됨(임베딩 캐시만 누적, 분석 이력 추가 없음).

### 2026-05-30

#### 세션 목표
- 사용자 요청 "리팩토링 + 성능 극대화" → 6차원 진단(다중 에이전트 워크플로우) → 검증된 발견 우선순위화 → Tier 1~4 구현.

#### 진단 방식
- 6개 차원(백엔드 hot path·LLM·라우트·부팅메모리·프론트 렌더·프론트 구조)을 병렬 진단 + 발견별 적대적 재검증. **검증 통과 47건 / 거짓양성 9건 기각**(예: "useCallback 누락"은 이미 useMemo 처리됨, "personas 직렬 fetch"는 실제 병렬).
- 임베딩 정규화를 직접 측정해 "정규화 버그" 발견 3건을 보정(실제로는 이미 정규화).

#### 변경 파일 (18개 + 신규 1개)
| 파일 | 변경 | 요약 |
|------|------|------|
| `services/scoring.py` | 수정 | `np.percentile` 3회 → `np.sort` 1회+보간(값 동일, ~23ms↓); `_category_bonus`를 store 캐시 사용 |
| `services/store.py` | 수정 | `nonempty_mask` 부팅 캐시 신설(매 요청 1M `str.len()` 제거, ~244ms↓); `cosine_topk` 불필요 norm 나눗셈 제거 |
| `lib/api.ts` | 수정 | 수동 fetch 17개 → `_jsonRequest` 통일 (**−187줄**, products/extract 3개는 특수 포맷 보존) |
| `abtest/ABTestResultPanel.tsx` | 수정 | `MarkdownSection` `React.memo`(ReactMarkdown 재파싱 차단) |
| `PersonaCardGrid.tsx` + `personas/page.tsx` | 수정 | `PersonaCardItem` memo + `toggleSelect` useCallback |
| `app/page.tsx`, `app/overview/page.tsx` | 수정 | KoreaMap `next/dynamic`(ssr:false) 청크 분리 |
| `services/fileio.py` | **신규** | JSONL `append/read/rewrite` + `atomic_write_text` 공통 헬퍼 |
| `persistence.py`, `abtest_persistence.py` | 수정 | fileio로 위임 (−83/−49줄) |
| `survey_repo.py`, `segment_repo.py` | 수정 | `_atomic_write` → fileio, 고아 `os`/`tempfile` import 정리 |
| `llm.py` + opinions/simulation/abtest_llm/commentary | 수정 | `enforce_provider()` 헬퍼 + provider 강제 6곳 중앙화 |
| `services/llm/` (패키지) | **분해** | `llm.py` 1477줄 God 모듈 → 7개 레이어(provider/config/clients/embedding/schemas/service/`__init__`). `__init__` re-export로 import 10개 파일 무수정 호환. service↔wrapper 순환 회피 위해 도메인 수직분할 대신 **레이어 분할**. 원본 `.archive/2026-05-30_llm-package-refactor/llm_monolith.py` 보존 |
| `routes/dataset.py` + `services/persona_filter.py` (신규) | **서비스 추출** | dataset.py **645→151줄**. `personas_filter` 376줄 핸들러 + 모델 5개·상수 3개를 `persona_filter.py`로. 라우트는 HTTP 변환만(ValueError→HTTPException). SRP: 라우트=HTTP, 서비스=로직 |
| `wizard/StepQuestions.tsx`·`StepTargets.tsx` (분해) | **컴포넌트 분해** | StepQuestions **721→387**(+`QuestionEditor` 213·`QuestionPreview` 77·`questionUtils` 62), StepTargets **623→507**(+`TargetPreview` 124). 편집/미리보기/유틸을 응집 파일로 분리. props 인터페이스·JSX 불변. tsc 0·빌드 성공 |
| UX/접근성 18개 파일 | **톤-중립 a11y/UX** | ui-ux-pro-max 진단(45 에이전트) → 검증된 톤-중립 **27건**: aria(페이지네이션 aria-current·모달 포커스 관리·표 scope/caption·KoreaMap sr요약+데이터텍스트)·focus-visible(azure ring)·motion-reduce 3곳·터치타겟 44px·폼 aria-describedby/invalid/live·CLS min-h·inputMode numeric. **한화 시각 톤 100% 보존**(git diff 비한화 색 0건 교차검증). 시각 톤 변경 필요 8건은 외부 도구 영역으로 제외 |

#### 측정 결과 (운영 1M, pm2 재기동 실측)
| 구간 | Before | After | 효과 |
|------|--------|-------|------|
| `/analyze` score 단계 | 3,077ms | **2,405ms** | **−672ms (−22%)** |
| percentile (마이크로벤치) | 29ms | 6ms | −79% |
| category_bonus (3카테고리) | ~244ms/요청 | 0 (부팅 캐시) | 매 요청 제거 |

#### 결정 사항
- **category nonempty는 정적 속성** → `store.nonempty_mask` 부팅 캐시. 최대 ROI(percentile의 ~10배).
- **provider 중앙화**: 강제 정책을 `enforce_provider()` 1곳으로. 해제 시 단일 함수만 수정.
- **Tier 4 대형 리팩토링 보류**(회귀 위험, 별도 세션): `llm.py` 1467줄 분해, `dataset.py` 381줄 서비스 추출, `StepQuestions`(721)/`StepTargets`(623) 거대 컴포넌트 분해, JSONL read O(n) → 인덱싱.

#### 검증
- 정합성 단위(100k): category 캐시==직접 **diff 0**, percentile sort==`np.percentile` **diff 0.0000**
- `tsc --noEmit` exit 0, ruff All passed, `next build` exit 0(KoreaMap 청크 분리)
- 영속화 운영 호환(analyses 42·abtests 21 read 정상) + 라운드트립 + persist→list→get→delete 사이클
- pm2 web+api 재기동 → 헬스 200, 핵심 페이지 200, 자연어 검색 정상(유사도 내림차순·search 85ms)

#### 현재 상태
- 성능·구조 최적화 완료, production 반영. 진단/검증 워크플로우로 거짓양성 제거 후 검증된 항목만 적용.
- ⚠️ 테스트로 분석 이력 3건이 `data/analyses.jsonl`에 추가됨 (`/history`에서 정리 가능).

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
