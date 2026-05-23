---
name: project
description: PersonaFit 프로젝트 핵심 요약. 프로젝트 구조와 기술 스택 파악용.
last-updated: 2026-05-20
---

# 프로젝트 개요

> **PersonaFit** — 상품설명서·약관을 입력하면 Nemotron-Personas-Korea 기반으로 반응할 타겟 페르소나·반응도·공략 지역을 산출해 상품기획자/FP에게 인사이트를 제공하는 도구.

---

## TL;DR

| 항목 | 내용 |
|------|------|
| **프로젝트** | PersonaFit |
| **목적** | 상품설명서·약관 → 반응 타겟 페르소나 + 반응도 점수 + 공략 지역 자동 산출 |
| **기술 스택** | Next.js + Tailwind / FastAPI / Supabase(Postgres) / Anthropic + OpenAI API / HuggingFace Datasets |
| **MVP 기능** | 상품 입력 · LLM 소구점 분석 · 페르소나 매칭/스코어링 · 지역 분포 시각화 · 공략 가이드 리포트 |
| **작업 관리** | [TODO: 도구 선정 후 링크 추가] |

---

## 프로젝트 구조

```
ai_hack/
├── package.json                  # pnpm 워크스페이스 루트
├── pnpm-workspace.yaml           # apps/web 워크스페이스 매핑
├── .env.example                  # 환경변수 템플릿 (Anthropic/OpenAI/Supabase)
├── .gitignore
├── agent-guide/                  # AI 에이전트 가이드 문서
│   ├── GUIDE.md
│   ├── PROJECT.md
│   ├── SESSION.md
│   └── plans/                    # 작업 계획서
├── apps/
│   ├── web/                      # Next.js 14 + Tailwind + TS (App Router)
│   │   ├── app/                  # 페이지/레이아웃 (App Router)
│   │   └── package.json
│   └── api/                      # FastAPI + uv (Python 3.12)
│       ├── main.py               # 진입점 (/health)
│       ├── pyproject.toml
│       └── .venv/                # uv 가상환경
├── supabase/
│   └── migrations/               # SQL 마이그레이션 (Phase 1에서 추가)
└── scripts/                      # 데이터셋 ETL, 임베딩 생성 등
    ├── explore_personas.py       # 데이터셋 탐색 스크립트 (완료)
    └── sample_personas.json      # 샘플 3행 (탐색 결과)
```

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| **프론트엔드** | Next.js (App Router) + Tailwind CSS |
| **백엔드** | FastAPI (Python) |
| **데이터베이스** | Supabase (PostgreSQL) — 페르소나 캐시, 분석 결과 저장, pgvector 활용 가능 |
| **LLM** | Anthropic Claude API (소구점 추출·리포트 생성) + OpenAI API (임베딩·보조 분석) |
| **데이터셋** | HuggingFace `nvidia/Nemotron-Personas-Korea` — 합성 한국인 페르소나 |
| **인프라** | [TODO: Vercel / Fly.io / Render / AWS 중 선택] |

---

## 핵심 파일

[TODO: 구현 후 핵심 파일 추가]

> 구현 진행에 따라 추가:
> - 데이터셋 로딩/전처리 스크립트
> - 페르소나 임베딩 생성 스크립트
> - LLM 소구점 추출 프롬프트
> - 반응도 스코어링 로직
> - Next.js 메인 분석 페이지

---

## 데이터 흐름 (계획)

```
[상품설명서·약관 입력]
        │
        ▼
[Claude로 소구점·타겟 특성 추출]
        │
        ▼
[OpenAI 임베딩으로 페르소나와 유사도 매칭]
        │
        ▼
[반응도 스코어링 + 지역별 집계]
        │
        ▼
[Next.js 대시보드: 페르소나·지역·리포트 시각화]
```

---

## 빠른 시작

```bash
# 1) 의존성 설치
pnpm install                      # 프론트 (apps/web)
cd apps/api && uv sync            # 백엔드

# 2) 환경변수 설정
cp .env.example .env              # 실제 키 입력 (ANTHROPIC/OPENAI/SUPABASE)

# 3) 데이터 적재 (Phase 1 완료 후 1회만)
# supabase db push                # 마이그레이션 적용
# python scripts/sample_and_load.py
# python scripts/embed_personas.py

# 4) 개발 서버 실행 (각각 별도 터미널)
pnpm --filter web dev             # Next.js → http://localhost:3000
cd apps/api && uv run uvicorn main:app --reload  # FastAPI → http://localhost:8000
```

### 부팅 검증
- Next.js: `curl http://localhost:3000` → HTTP 200
- FastAPI: `curl http://localhost:8000/health` → `{"ok":true,"service":"personafit-api"}`

---

## 상세 참조

| 문서 | 내용 |
|------|------|
| [SESSION.md](SESSION.md) | 현재 상태, 세션 로그 |
| [GUIDE.md](GUIDE.md) | 작업 원칙, MCP 도구 |
| [Nemotron-Personas-Korea](https://huggingface.co/datasets/nvidia/Nemotron-Personas-Korea) | 외부 데이터셋 원본 |
