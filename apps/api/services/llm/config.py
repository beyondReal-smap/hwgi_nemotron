"""LLM 모델·엔드포인트 상수 + 프롬프트 로딩 + 도메인 공통 enum.

PROMPTS_DIR는 패키지(services/llm/)에서 두 단계 위(apps/api)의 prompts/를 가리킨다.
"""

from __future__ import annotations

import os
from pathlib import Path

CLAUDE_SONNET = "claude-sonnet-4-6"
CLAUDE_HAIKU = "claude-haiku-4-5"
# OpenAI(상용) — 관리자 미설정 시 폴백. 실제 모델은 runtime_config의 openai_model이 우선.
OPENAI_DEFAULT_MODEL = "gpt-5.4"
EMBED_MODEL = "text-embedding-3-small"
EMBED_DIM = 1536

# sLLM (OpenAI 호환 vLLM) — base URL은 env(SLLM_BASE_URL)로 주입, 모델명은
# resolve_sllm_model()로 lazy 결정. 운영 호스트(사내 IP)는 코드에 두지 않고 .env로만 주입한다.
# (내부 인프라 주소가 VCS·번들에 남는 정보 노출 + 환경 이전 시 잘못된 호스트로 조용히
#  붙는 리스크 방지) 미설정 시 localhost 기본값 → 실제 sLLM 사용 시 연결 단계에서 fail-fast.
SLLM_BASE_URL = os.environ.get("SLLM_BASE_URL", "http://localhost:5015/v1")

# services/llm/config.py → parent(llm) → parent.parent(services) → parent.parent.parent(apps/api)
PROMPTS_DIR = Path(__file__).resolve().parent.parent.parent / "prompts"
SELLING_POINTS_PROMPT = (PROMPTS_DIR / "selling_points.md").read_text(encoding="utf-8")
REPORT_PROMPT = (PROMPTS_DIR / "report.md").read_text(encoding="utf-8")
COMMENTARY_PROMPT = (PROMPTS_DIR / "commentary.md").read_text(encoding="utf-8")
ABTEST_COMPANY_PROMPT = (PROMPTS_DIR / "abtest_company.md").read_text(encoding="utf-8")
ABTEST_STRATEGY_PROMPT = (PROMPTS_DIR / "abtest_strategy.md").read_text(encoding="utf-8")
SURVEY_PLACEHOLDER_PROMPT = (PROMPTS_DIR / "survey_placeholder.md").read_text(encoding="utf-8")


def _load_openai_prompt(name: str) -> str:
    """OpenAI(gpt-5.4) 전용 프롬프트(prompts/openai/). 없으면 기본 프롬프트로 폴백.

    OpenAI는 큰 컨텍스트·고급 추론을 살려 분량 제약 없이 더 깊은 분석을 하도록 별도 프롬프트를 쓴다.
    sLLM/anthropic은 기존 프롬프트(27B 최적화) 유지.
    """
    p = PROMPTS_DIR / "openai" / name
    base = PROMPTS_DIR / name
    return (p if p.exists() else base).read_text(encoding="utf-8")


# OpenAI 전용 프롬프트 (분석·A/B·총평·소구점·placeholder)
SELLING_POINTS_PROMPT_OPENAI = _load_openai_prompt("selling_points.md")
REPORT_PROMPT_OPENAI = _load_openai_prompt("report.md")
COMMENTARY_PROMPT_OPENAI = _load_openai_prompt("commentary.md")
ABTEST_COMPANY_PROMPT_OPENAI = _load_openai_prompt("abtest_company.md")
ABTEST_STRATEGY_PROMPT_OPENAI = _load_openai_prompt("abtest_strategy.md")
SURVEY_PLACEHOLDER_PROMPT_OPENAI = _load_openai_prompt("survey_placeholder.md")
# OpenAI 전용 — opinions/simulation/schemas 인라인 대응 (기본은 각 모듈이 보유, OpenAI만 여기)
PERSONA_OPINION_PROMPT_OPENAI = _load_openai_prompt("persona_opinion.md")
SURVEY_RESPONSE_PROMPT_OPENAI = _load_openai_prompt("survey_response.md")
PERSONA_ANSWER_SYSTEM_OPENAI = _load_openai_prompt("persona_answer.md")
SUGGEST_QUESTIONS_SYSTEM_OPENAI = _load_openai_prompt("suggest_questions.md")
QUERY_FILTER_EXTRACT_SYSTEM_OPENAI = _load_openai_prompt("query_filter.md")

MAX_PRODUCT_TEXT_CHARS = 8000  # 입력 truncate (토큰 보호)


# ============================================================
# 도메인 공통 enum (소구점 추출 · 쿼리 필터 추출이 공유)
# ============================================================

_EDUCATION_ENUM = [
    "무학",
    "초등학교",
    "중학교",
    "고등학교",
    "2~3년제 전문대학",
    "4년제 대학교",
    "대학원",
]

# 17개 시도 — 데이터셋 정규화 표기와 정확히 일치해야 함 (store._PROVINCE_SHORT_MAP 적용 후)
_PROVINCE_ENUM = [
    "강원", "경기", "경남", "경북", "광주", "대구", "대전",
    "부산", "서울", "세종", "울산", "인천", "전남", "전북",
    "제주", "충남", "충북",
]

_MARITAL_ENUM = ["미혼", "배우자있음", "사별", "이혼"]

# 동적 필터 가능 컬럼·값 — 시스템 프롬프트에 주입해서 LLM이 자유롭게 활용.
# 카디널리티 작은 컬럼만 (district 252개는 자유 키워드로 별도 처리 — 일단 제외).
_DYNAMIC_COLUMNS_SCHEMA: dict[str, list[str]] = {
    "housing_type": [
        "아파트", "단독주택", "다세대주택", "주택 이외의 거처",
        "연립주택", "비주거용 건물 내 주택",
    ],
    "bachelors_field": [
        "해당없음", "공학·제조·건설", "경영·행정·법", "예술·인문",
        "보건·복지", "교육", "정보통신기술", "서비스",
        # 실측 교정: '자연과학·수학·통계'·'농림·수산·수의'·'기타'는 데이터셋에 없는 환상값이라
        # LLM이 출력 시 isin 0매칭 유발 → 실제값으로 교체 + 누락됐던 '사회과학·언론' 추가.
        "사회과학·언론", "자연과학·수학", "농림어업·수의학",
    ],
    "military_status": ["비현역", "현역"],
}
