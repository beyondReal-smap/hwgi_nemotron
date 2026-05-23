# 작업 계획서 (Master): 설문 시뮬레이션 플랫폼 MVP

> 작성일: 2026-05-21 | 상태: 초안 | 모드: Split

## TL;DR (5줄 이내)

- **무엇**: PersonaFit를 "Nemotron-Korea 100만 페르소나 대상 설문 시뮬레이션" 플랫폼으로 확장
- **왜**: 실제 사용자 모집 없이 LLM이 페르소나 입장에서 설문에 응답해 시장·UX·정책 리서치를 즉시 수행
- **범위**: 신규 라우트 5개(`/personas`, `/surveys/new`, `/surveys/:id/{progress,responses,report}`) · 신규 데이터 모델 4종(JSON 영속화) · Phase 7개 · 파일 ~32개 · 예상 ~8.5일
- **핵심 리스크**: 페르소나 1k × 질문 20 = 20k LLM 호출 비용·지연 → 캐싱·배치·재시도 정책 필수

---

## 개요

### 목표

- 사용자가 자연어 또는 필터로 페르소나 그룹을 선별하고, 설문지를 만들어, LLM에게 각 페르소나의 응답을 시뮬레이션시키고 결과를 차트로 분석할 수 있는 end-to-end 플로우를 제공한다.

### 배경

- 기존 PersonaFit는 "약관·상품 → 매칭 페르소나 → 가상 설문" 흐름의 단방향 도구
- 신규 스펙은 "자유 설문 생성 → 페르소나 선별 → 시뮬 → 분석"으로 흐름 역전 및 일반화
- 100만 행 임베딩·자연어 검색·LLM 듀얼 클라이언트·디자인 시스템은 그대로 재활용

### 성공 기준

- [ ] `/personas`에서 자연어/필터로 페르소나 선별 후 세그먼트 저장 가능 (JSON 영속)
- [ ] `/surveys/new` 4-step 마법사로 설문지 생성 → 시뮬레이션 시작 가능
- [ ] `/surveys/:id/progress`에서 polling으로 실시간 진행률 확인 가능
- [ ] `/surveys/:id/responses`에서 페르소나별·질문별 응답 조회 가능
- [ ] `/surveys/:id/report`에서 객관식/척도/주관식 차트 리포트 확인 가능
- [ ] 응답 캐싱으로 동일 (페르소나+질문+모델) 재실행 시 LLM 호출 0회

### 범위

- **포함**: 신규 페이지 5개 · 데이터 모델 4종 · LLM 응답 프롬프트 + 캐싱 + 재시도 · 차트 리포트(객관식 도넛/막대, 척도 히스토그램, 주관식 인용)
- **제외**: 파일 업로드 파싱(xlsx/docx) · 분기(skip) 로직 · WebSocket 실시간(polling으로 대체) · 인증/권한 · AI 인사이트 자동 생성 · PDF/Excel export · 다국어 · A/B 비교 · Supabase 마이그레이션 (Phase 2 이상)

---

## 현황 분석

### 관련 파일

| 파일 | 역할 | 변경 유형 | 담당 Part |
|------|------|----------|-----------|
| `apps/web/app/personas/page.tsx` | 페르소나 탐색 페이지 | 신규 | part1 |
| `apps/web/components/PersonaFilterPanel.tsx` | 필터 사이드바 | 신규 | part1 |
| `apps/web/components/PersonaCardGrid.tsx` | 카드/테이블 뷰 | 신규 | part1 |
| `apps/web/components/PersonaDetailModal.tsx` | 상세 모달 | 신규 | part1 |
| `apps/web/components/SiteHeader.tsx` | 네비 항목 추가 | 수정 | part1 |
| `apps/api/routes/dataset.py` | 필터 검색 엔드포인트 추가 | 수정 | part1 |
| `apps/api/models/survey.py` | Survey/Question/Session/Answer Pydantic | 신규 | part2 |
| `apps/api/services/survey_repo.py` | JSON 영속화 (CRUD) | 신규 | part2 |
| `apps/api/services/segment_repo.py` | 세그먼트 영속화 | 신규 | part2 |
| `apps/api/routes/surveys.py` | CRUD API (`/api/surveys`) | 신규 | part2 |
| `apps/api/routes/segments.py` | 세그먼트 API | 신규 | part2 |
| `apps/api/main.py` | 라우터 등록 | 수정 | part2 |
| `apps/web/lib/api.ts` | 타입·클라이언트 추가 | 수정 | part2 |
| `apps/web/app/surveys/new/page.tsx` | 4-step 마법사 | 신규 | part3 |
| `apps/web/components/wizard/StepBasic.tsx` | Step 1 — 기본정보 | 신규 | part3 |
| `apps/web/components/wizard/StepTargets.tsx` | Step 2 — 대상자 선별 | 신규 | part3 |
| `apps/web/components/wizard/StepQuestions.tsx` | Step 3 — 질문 설계 | 신규 | part3 |
| `apps/web/components/wizard/StepExecution.tsx` | Step 4 — 실행 설정 | 신규 | part3 |
| `apps/web/components/wizard/WizardShell.tsx` | 마법사 공통 셸 | 신규 | part3 |
| `apps/api/services/survey_engine.py` | 응답 생성 엔진(Q→Persona→LLM→Answer) | 신규 | part4 |
| `apps/api/services/answer_cache.py` | 응답 캐시 (persona+question+model) | 신규 | part4 |
| `apps/api/services/survey_run.py` | 비동기 실행자(BackgroundTasks) | 신규 | part4 |
| `apps/api/routes/survey_run.py` | `POST /api/surveys/:id/run` | 신규 | part4 |
| `apps/api/services/llm.py` | 답변 응답 함수 추가(answer/reasoning/conf) | 수정 | part4 |
| `apps/web/app/surveys/[id]/progress/page.tsx` | 진행 모니터링 | 신규 | part5 |
| `apps/web/components/SurveyProgress.tsx` | 진행 바·통계 | 신규 | part5 |
| `apps/api/routes/survey_progress.py` | `GET /api/surveys/:id/status` | 신규 | part5 |
| `apps/web/app/surveys/[id]/responses/page.tsx` | 응답 조회 | 신규 | part6 |
| `apps/web/components/ResponsesByPersona.tsx` | 페르소나별 뷰 | 신규 | part6 |
| `apps/web/components/ResponsesByQuestion.tsx` | 질문별 뷰 | 신규 | part6 |
| `apps/web/app/surveys/[id]/report/page.tsx` | 차트 리포트 | 신규 | part6 |
| `apps/web/components/ReportChartChoice.tsx` | 객관식 도넛/막대 | 신규 | part6 |
| `apps/web/components/ReportChartScale.tsx` | 척도 히스토그램 | 신규 | part6 |
| `apps/web/components/ReportOpenEnded.tsx` | 주관식 인용 카드 | 신규 | part6 |

### 의존성

- **이 작업이 의존하는 것**: 기존 `store.py` 임베딩 인메모리 로드 / `llm.py` 듀얼 클라이언트 / `persistence.py` 패턴
- **이 작업에 의존하는 것**: Phase 2(추후) — AI 인사이트, PDF 리포트, Supabase 영구화

---

## 정량 요약 + Phase 맵

> 총 Phase: 7개 | 총 Part: 6개 | 변경 파일: ~33개 (신규 ~28, 수정 ~5)

| Part | Phase | 범위 | 파일 수 | 상태 |
|------|-------|------|---------|------|
| [part1](part1-explore.md) | 1 | 페르소나 탐색 `/personas` | 6 | ✅ 완료 |
| [part2](part2-data-model.md) | 2 | 데이터 모델·JSON 영속화·CRUD API | 7 | ✅ 완료 |
| [part3](part3-wizard.md) | 3 | 설문 생성 마법사 `/surveys/new` (4 step) | 6 | ✅ 완료 |
| [part4](part4-engine.md) | 4 | 응답 생성 엔진 + 캐싱 + 재시도 | 5 | ✅ 완료 |
| [part5](part5-monitor.md) | 5 | 진행 모니터링 `/surveys/:id/progress` (polling) | 3 | ✅ 완료 |
| [part6](part6-result-report.md) | 6-7 | 응답 조회 + 차트 리포트 | 6 | ✅ 완료 |

> 상태: ⬜ 대기 / 🟡 진행중 / ✅ 완료 / ⚠️ 차단
> Phase 완료 시 해당 Part 행의 상태를 갱신. part 내 일부 phase만 완료면 🟡(진행중) 유지.

---

## 전체 리스크

| 리스크 | 가능성 | 영향 | 대응 방안 | 관련 Part |
|--------|--------|------|----------|-----------|
| LLM 호출 비용 폭증 (20k 호출) | 높 | 높 | 캐시 키 (persona+question+model) · 배치 동시성 제한(예: 8) · 비용 사전 산출 | part4 |
| LLM 응답 스키마 불일치(answer/reasoning/conf 누락) | 중 | 중 | tool_use로 스키마 강제, 실패 시 재시도 후 partial 표시 | part4 |
| 100만 페르소나 필터링 응답 속도 저하 | 중 | 중 | 메타데이터 필터는 인메모리 numpy mask, 자연어는 기존 cosine + 임계값 재사용 | part1, part4 |
| JSON 영속화 race condition (동시 쓰기) | 중 | 중 | survey_id 단위 파일 lock, atomic write(`tmp→rename`) | part2 |
| 기존 `/survey` 라우트 혼동 | 낮 | 낮 | 신규 복수형 `/surveys`로 분리, 기존 `/survey`는 유지 + 헤더에서 deprecate 표시 | part1, part3 |
| WebSocket 미구현으로 진행률 지연 | 낮 | 낮 | polling 간격 2초, 완료 시 stop. WebSocket은 Phase 2로 명시적 후순위 | part5 |
| Recharts 데이터 변환 비용 (1k 응답) | 낮 | 낮 | 백엔드에서 집계 완료 후 반환 (Chart 데이터 사전 가공) | part6 |

## 전체 검증 계획

- [ ] **빌드**: `pnpm --filter web build` EXIT 0 + `python -m compileall apps/api` (또는 import 검증)
- [ ] **타입**: `npx tsc --noEmit` 통과
- [ ] **API 스모크**: 신규 엔드포인트 9종에 대해 `curl` 200 응답 확인
  - `GET /api/dataset/personas/filter`
  - `GET/POST /api/segments`
  - `GET/POST /api/surveys`
  - `POST /api/surveys/:id/run`
  - `GET /api/surveys/:id/status`
  - `GET /api/surveys/:id/responses`
  - `GET /api/surveys/:id/report`
- [ ] **E2E 시나리오**:
  - (1) `/personas`에서 "30대 워킹맘 수도권" 검색 → 세그먼트 저장
  - (2) `/surveys/new`에서 위 세그먼트 불러옴 → 객관식 3 + 척도 1 + 주관식 1 = 5문항 → 100명 × 5 = 500 응답 시뮬레이션
  - (3) `/progress`에서 진행률 100% 도달 → `/responses` 두 뷰 모두 동작 → `/report` 차트 3종 모두 렌더
- [ ] **운영 반영**: 각 Part 완료 시 `pnpm --filter web build && pm2 restart personafit-api personafit-web --update-env`
- [ ] **디자인 일관성**: 모든 신규 섹션은 `SectionCard`(bg-snow + border-l-4 border-l-terra) 사용, 한화 토큰만 사용

---

**이 계획에 대해 의견이 있으시면 말씀해 주세요.**
