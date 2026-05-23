---
name: session
description: 프로젝트 현재 상태. 세션 시작 시 현재 상태 파악용.
last-updated: 2026-05-20
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
| P1 | UI 시각적 폴리시 (헤더/색상/통계 강조) | In Progress |
| P1 | 종합 검증 (work-verify) | Todo |
| P1 | Phase 5 — Supabase 무료 업로드 (10만 행) | Todo (대표님 Supabase 가입 후) |
| P2 | 100만 행 임베딩 batch (~$4, ~5시간) + GitHub Release | Todo |
| P2 | HuggingFace fork 업로드 (선택) | Todo |

---

## 확정 사항

- **샘플 크기**: 개발·데모 10만 행 / 제출 100만 행 임베딩 별도 (하이브리드)
- **LLM 모델**: 소구점 추출 = `claude-sonnet-4-6`, 리포트 = `claude-haiku-4-5`, 임베딩 = `text-embedding-3-small`
- **배포**: 로컬 데모 한정 (Vercel/Fly.io는 v2)
- **운영**: pm2 (`personafit-web` 5101 외부 / `personafit-api` 5102 내부)
- **DB 전략**: 인메모리 (parquet + numpy) — 검색 < 500ms, Supabase는 Phase 5에서

---

## 가동 중인 서비스

- 🌐 http://localhost:5101 (Next.js, 외부 접근)
- ⚙️ http://127.0.0.1:5102 (FastAPI, 내부, Next.js rewrites 프록시)
- `pm2 list` / `pm2 logs personafit-web` / `pm2 restart personafit-*`

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

- **API 키 확보**: Anthropic, OpenAI, Supabase 자격증명 필요
- **호스팅 결정**: 해커톤 일정에 맞춰 Vercel + Fly.io 등 빠른 배포 옵션 검토
- **임베딩 비용**: 10만 행 × 1536차원 임베딩 시 OpenAI 비용 ~$2 수준 (text-embedding-3-small $0.02/1M token 가정)
- **occupation 정규화 검토**: 자유텍스트 → KSCO 한국표준직업분류 매핑이 필요할지 v2에서 결정

---

## 최근 세션

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
