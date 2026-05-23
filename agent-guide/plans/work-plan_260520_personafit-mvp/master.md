# 작업 계획서 (Master): PersonaFit MVP

> 작성일: 2026-05-20 | 상태: 확정 (2026-05-20) | 모드: Split

## 확정 사항 (2026-05-20)

- **샘플 크기**: 개발·데모 = **10만 행** / 제출 = **100만 행 임베딩 풀 데이터셋**
- **LLM 모델 분리**: 소구점 추출 = `claude-sonnet-4-6`, 리포트 생성 = `claude-haiku-4-5`
- **배포**: 로컬 데모 한정 (Vercel/Fly.io 배포는 제외)
- **DB 전략 (하이브리드)**:
  - Phase 1-4: **로컬 parquet + numpy 인메모리** (DB 없이 개발 반복)
  - Phase 5 (제출 직전): **Supabase 무료 티어**에 10만 행만 업로드 (데모 운영용)
  - 별도 산출물: 100만 행 임베딩 Parquet → GitHub Release (제출용)
- **제출물 3종**: ① 코드 GitHub Repo ② 10만 행 Supabase 데모 ③ 100만 행 임베딩 Parquet

## TL;DR (필수, 5줄 이내)

- **무엇**: 상품설명서·약관 입력 → Nemotron-Personas-Korea 기반 타겟 페르소나·반응도·공략 지역 산출 도구
- **왜**: 상품기획자/FP가 출시 전 타겟 적합도와 공략 지역을 정량적으로 검증할 수단이 없음
- **범위**: 파일 약 30개 · Phase 6개 · 예상 2-3일(해커톤)
- **핵심 리스크**: 임베딩 비용·시간(10만 행 ≈ $2, ~30분), 100만 행 풀스캔 회피 위해 stratified 샘플링 필수

---

## 개요

### 목표 (필수, 2문장)

- 상품설명서·약관 텍스트 1건 입력 시 30초 이내에 ① 상위 타겟 페르소나 N명 ② 0–100 반응도 점수 ③ 시도/시군구 공략 랭킹 ④ FP/기획자용 인사이트 리포트를 화면에 출력하는 웹 도구를 만든다.
- 데이터 출처는 `nvidia/Nemotron-Personas-Korea`(10만 행 샘플)이며, 분석 엔진은 Claude(소구점 추출/리포트)와 OpenAI 임베딩(매칭)을 결합한다.

### 배경 (선택, 3줄)

- Nemotron-Personas-Korea는 한국 인구통계 기반 100만 합성 페르소나 + 17 시도/252 시군구 + 7개 카테고리 페르소나 텍스트 보유 → 상품 타겟 분석에 즉시 활용 가능
- 상품기획·FP 영업 현장은 "어떤 고객층이 반응할지" 직관에 의존 → 정량 근거 부재
- 해커톤 기간이 짧아 데모 가능한 핵심 흐름(입력 → 매칭 → 시각화 → 리포트)만 일관성 있게 완성하는 것이 우선

### 성공 기준 (필수, 3-5개)

- [ ] 샘플 약관 1건 입력 → 30초 이내 결과 화면 표시 (UI 응답 기준)
- [ ] 상위 페르소나 20명 + 반응도 점수(0–100) + 17개 시도 막대그래프 표시
- [ ] 시도 drill-down → 해당 시도의 상위 시군구·페르소나 확인 가능
- [ ] FP/기획자용 인사이트 리포트(Claude 생성, 마크다운) 화면 우측에 표시
- [ ] Supabase에 분석 이력 저장(상품 입력 텍스트, 결과 JSON, 생성 시각)

### 범위 (필수)

- **포함**:
  - Next.js + Tailwind 단일 페이지(입력 폼 + 결과 대시보드)
  - FastAPI 단일 분석 엔드포인트(`POST /api/analyze`)
  - Supabase: `personas`(10만) + `analyses`(이력) 2개 테이블 + pgvector 인덱스
  - LLM: Claude로 소구점 추출 + 리포트 생성, OpenAI로 임베딩
  - 10만 행 stratified 샘플링 (province × age_bucket × sex)
- **제외**:
  - 사용자 인증/조직 관리 (해커톤 후 v2)
  - 100만 행 풀 임베딩 (10만으로 충분히 데모)
  - KSCO(한국표준직업분류) 매핑
  - 모바일 전용 UI (반응형은 기본)
  - A/B 테스트 메시지 자동 생성

---

## 현황 분석

### 관련 파일 (필수)

| 파일 | 역할 | 변경 유형 | 담당 Part |
|------|------|----------|-----------|
| `package.json` (루트) | pnpm workspace 정의 | 신규 | part1 |
| `pnpm-workspace.yaml` | 워크스페이스 매핑 | 신규 | part1 |
| `apps/web/` | Next.js App Router 앱 | 신규 | part1, part3 |
| `apps/api/pyproject.toml` | FastAPI 의존성 (uv) | 신규 | part1 |
| `apps/api/main.py` | FastAPI 진입점 | 신규 | part1, part2 |
| `apps/api/services/llm.py` | Claude·OpenAI 클라이언트 | 신규 | part2 |
| `apps/api/services/scoring.py` | 반응도 스코어링 로직 | 신규 | part2 |
| `apps/api/services/supabase_client.py` | Supabase 클라이언트 (싱글톤) | 신규 | part2 |
| `apps/api/prompts/selling_points.md` | Claude 소구점 추출 프롬프트 | 신규 | part2 |
| `apps/api/prompts/report.md` | Claude 리포트 생성 프롬프트 | 신규 | part2 |
| `apps/api/routes/analyze.py` | `POST /api/analyze` | 신규 | part2 |
| `supabase/migrations/0001_personas.sql` | personas 테이블 + pgvector | 신규 | part1 |
| `supabase/migrations/0002_analyses.sql` | analyses 이력 테이블 | 신규 | part1 |
| `scripts/sample_and_load.py` | 10만 행 stratified 샘플링 + 적재 | 신규 | part1 |
| `scripts/embed_personas.py` | OpenAI 임베딩 배치 생성 | 신규 | part1 |
| `scripts/explore_personas.py` | (기존) 탐색용 스크립트 | 유지 | - |
| `apps/web/app/page.tsx` | 메인 페이지 | 신규 | part3 |
| `apps/web/components/InputForm.tsx` | 상품 입력 폼 | 신규 | part3 |
| `apps/web/components/ScoreCard.tsx` | 반응도 점수 카드 | 신규 | part3 |
| `apps/web/components/PersonaList.tsx` | 상위 페르소나 리스트 | 신규 | part3 |
| `apps/web/components/RegionChart.tsx` | 시도/시군구 분포 차트 | 신규 | part3 |
| `apps/web/components/ReportPanel.tsx` | 리포트 마크다운 렌더링 | 신규 | part3 |
| `apps/web/lib/api.ts` | FastAPI 호출 클라이언트 | 신규 | part3 |
| `.env.example` | 환경변수 템플릿 | 신규 | part1 |
| `README.md` | 빠른 시작 가이드 | 신규 | part3 |

### 의존성 (선택)

- **이 작업이 의존하는 것**:
  - Supabase 프로젝트 생성 (Free tier 가능, pgvector extension 활성화)
  - API 키: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
  - HuggingFace 데이터셋 다운로드 (CC BY 4.0)
- **이 작업에 의존하는 것**: 해커톤 발표 데모, 향후 v2(인증·다중 상품 비교·A/B 메시지 생성)

---

## 정량 요약 + Phase 맵 (필수)

> 총 Phase: 6개 | 총 Part: 3개 | 변경 파일: 약 25개 (신규 24, 유지 1)

| Part | Phase | 범위 | 파일 수 | 상태 |
|------|-------|------|---------|------|
| [part1](part1-foundation.md) | 0-1 | 모노레포 스캐폴딩 + 10만 행 stratified 샘플링 + 임베딩 (로컬 parquet/npy) | 약 10 | ✅ 완료 |
| [part2](part2-analysis-api.md) | 2-3 | LLM 소구점 추출 + 인메모리 스코어링 + FastAPI 엔드포인트 | 약 9 | ✅ 완료 |
| [part3](part3-frontend-integration.md) | 4-5 | Next.js UI + Supabase 업로드 + 100만 행 임베딩 + Release | 약 14 | 🟡 진행중 (Phase 4 ✅, Phase 5 대기) |

### 추가 완료 사항 (계획서 외)

- **파일 업로드 기능**: TXT/PDF/DOCX/HWP/HWPX 자동 텍스트 추출 (`POST /api/extract-text`)
- **pm2 운영**: `ecosystem.config.cjs` — 5101(Next.js, 외부) + 5102(FastAPI, 내부 프록시)
- **README.md** 작성: Quickstart, 아키텍처, 알고리즘, 성능·비용

> 상태: ⬜ 대기 / 🟡 진행중 / ✅ 완료 / ⚠️ 차단

### 해커톤 타임라인 (참고)

| Day | Part | 핵심 산출물 |
|-----|------|------------|
| Day 1 오전 | part1 (Phase 0) | 모노레포 + Supabase 프로젝트 + `.env` 작동 |
| Day 1 오후 | part1 (Phase 1) | personas 10만 행 적재 + 임베딩 완료 |
| Day 2 오전 | part2 (Phase 2) | 소구점 추출 + 스코어링 로직 단위 동작 |
| Day 2 오후 | part2 (Phase 3) | `POST /api/analyze` 응답 200 + JSON 정상 |
| Day 3 오전 | part3 (Phase 4) | UI에서 분석 → 결과 표시 (시각화 포함) |
| Day 3 오후 | part3 (Phase 5) | 리포트 + 데모 시나리오 + README + 배포 |

---

## 전체 리스크 (필수)

| 리스크 | 가능성 | 영향 | 대응 방안 | 관련 Part |
|--------|--------|------|----------|-----------|
| 100만 행 풀 임베딩 시 비용·시간 초과 | 높 | 중 | 10만 행 stratified 샘플링(province×age_bucket×sex) | part1 |
| pgvector 코사인 검색 느림 (10만 행) | 중 | 중 | `ivfflat` 인덱스 (lists=100) 사용, `probes=10` | part1, part2 |
| Claude 응답 JSON 파싱 실패 | 중 | 높 | Pydantic 스키마 + tool_use 모드 또는 JSON mode 강제 | part2 |
| 상품 입력이 매우 길면 토큰 초과 | 중 | 중 | 약관 본문은 8000자로 truncate + 핵심 추출만 | part2 |
| 임베딩 API 일시 장애 | 낮 | 높 | 임베딩은 사전 배치 처리, 입력 임베딩만 실시간 + 재시도 3회 | part2 |
| Supabase RLS 잘못 설정 시 데이터 노출 | 낮 | 높 | Service role key는 백엔드만 사용, anon key는 읽기 전용 RLS | part1 |
| 해커톤 데모 중 분석 30초 초과 | 중 | 높 | 후보 200명 사전 필터 → 임베딩 매칭 → 상위 20 반환 (단계적 좁히기) | part2 |
| OpenAI/Anthropic API 키 한도 | 낮 | 높 | 데모 전 사용량 사전 확인, 백업 키 준비 | 전체 |

## 전체 검증 계획 (필수)

- [ ] **단위 검증**:
  - `scripts/sample_and_load.py` 실행 후 `select count(*) from personas` = 100,000
  - `scripts/embed_personas.py` 실행 후 `embedding is not null` 비율 100%
  - `services/scoring.py::score_personas` 입력 임베딩에 대해 점수 0–100 범위 반환
- [ ] **통합 검증**:
  - `curl POST /api/analyze` 샘플 약관 1건 → 30초 이내 200 OK + 스키마 일치 JSON
  - Next.js dev 서버에서 입력 → 결과 화면까지 E2E 1회
  - Supabase `analyses` 테이블에 이력 1건 저장 확인
- [ ] **데모 검증**:
  - 보험상품 샘플 3종(여행자보험 / 어린이보험 / 종신보험) 각각 분석 → 페르소나 카테고리·지역 분포가 직관적으로 다름
  - 17개 시도 모두 막대그래프에 표시(데이터 없는 시도는 0으로)

---

**이 계획에 대해 의견이 있으시면 말씀해 주세요.**
