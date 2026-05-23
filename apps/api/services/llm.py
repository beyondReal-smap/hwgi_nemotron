"""LLM 추상화 — Anthropic Claude 또는 OpenAI 호환 sLLM(vLLM Qwen).

provider 인자로 두 경로를 선택:
- "anthropic": Sonnet(소구점) + Haiku(리포트·시뮬레이션)
- "sllm":      OpenAI 호환 엔드포인트의 단일 모델 (현재 Qwen3.6-27B-FP8)
                tool_use는 OpenAI function calling으로, system은 messages[0]으로 변환.

설계 원칙:
- 클라이언트는 앱 수명주기 싱글톤
- tenacity로 3회 재시도
- 임베딩은 항상 OpenAI (sLLM 무관)
"""

from __future__ import annotations

from abc import ABC, abstractmethod
import json
import os
import threading
import weakref
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import numpy as np
from anthropic import Anthropic
from openai import OpenAI
from tenacity import retry, stop_after_attempt, wait_exponential

from models.schemas import (
    PersonaHit,
    PopulationStats,
    RegionStat,
    SellingPoints,
)
from services import embed_cache

# ============================================================
# Provider 타입
# ============================================================

LLMProvider = Literal["anthropic", "sllm"]
# 기본 provider — 사내 sLLM(Qwen) 우선. Anthropic은 explicit하게 지정한 경우에만 사용.
DEFAULT_PROVIDER: LLMProvider = "sllm"


# ============================================================
# 모델 / 경로 상수
# ============================================================

CLAUDE_SONNET = "claude-sonnet-4-6"
CLAUDE_HAIKU = "claude-haiku-4-5"
EMBED_MODEL = "text-embedding-3-small"
EMBED_DIM = 1536

# sLLM (OpenAI 호환 vLLM) — 환경변수로 오버라이드 가능
SLLM_BASE_URL = os.environ.get("SLLM_BASE_URL", "http://3.38.195.121:5016/v1")
SLLM_MODEL = os.environ.get("SLLM_MODEL", "Qwen3.6-27B-FP8")

PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"
SELLING_POINTS_PROMPT = (PROMPTS_DIR / "selling_points.md").read_text(encoding="utf-8")
REPORT_PROMPT = (PROMPTS_DIR / "report.md").read_text(encoding="utf-8")
COMMENTARY_PROMPT = (PROMPTS_DIR / "commentary.md").read_text(encoding="utf-8")
ABTEST_COMPANY_PROMPT = (PROMPTS_DIR / "abtest_company.md").read_text(encoding="utf-8")
ABTEST_STRATEGY_PROMPT = (PROMPTS_DIR / "abtest_strategy.md").read_text(encoding="utf-8")

MAX_PRODUCT_TEXT_CHARS = 8000  # 입력 truncate (토큰 보호)


# ============================================================
# 싱글톤 클라이언트
# ============================================================

@lru_cache(maxsize=1)
def anthropic_client() -> Anthropic:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise RuntimeError("ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.")
    return Anthropic()


@lru_cache(maxsize=1)
def sllm_client() -> OpenAI:
    """sLLM(OpenAI 호환) 싱글톤. vLLM은 api_key 미사용이지만 SDK 요구로 dummy 전달."""
    return OpenAI(base_url=SLLM_BASE_URL, api_key="dummy-sllm-no-auth")


@lru_cache(maxsize=1)
def openai_client() -> OpenAI:
    if not os.environ.get("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY 환경변수가 설정되지 않았습니다.")
    return OpenAI()


# ============================================================
# 소구점 추출 (Claude Sonnet + tool_use)
# ============================================================

# tool_use 스키마 — SellingPoints와 동일 구조
_EDUCATION_ENUM = [
    "무학",
    "초등학교",
    "중학교",
    "고등학교",
    "2~3년제 전문대학",
    "4년제 대학교",
    "대학원",
]

_SELLING_POINTS_TOOL = {
    "name": "record_selling_points",
    "description": "상품 분석 결과를 구조화된 JSON으로 기록합니다.",
    "input_schema": {
        "type": "object",
        "properties": {
            "summary": {"type": "string"},
            "key_benefits": {"type": "array", "items": {"type": "string"}},
            "target_age_min": {"type": ["integer", "null"]},
            "target_age_max": {"type": ["integer", "null"]},
            "target_sex": {"type": "array", "items": {"type": "string"}},
            "target_family_types": {"type": "array", "items": {"type": "string"}},
            "target_education_levels": {
                "type": "array",
                "items": {"type": "string", "enum": _EDUCATION_ENUM},
                "description": "필요·우대 교육 수준 (7개 enum 중)",
            },
            "target_occupations": {
                "type": "array",
                "items": {"type": "string"},
                "description": "직업 키워드 (KSCO 일반 직군명, occupation 부분 매칭)",
            },
            "target_keywords": {"type": "array", "items": {"type": "string"}},
            "persona_category_weights": {
                "type": "object",
                "properties": {
                    "professional": {"type": "number"},
                    "sports": {"type": "number"},
                    "arts": {"type": "number"},
                    "travel": {"type": "number"},
                    "culinary": {"type": "number"},
                    "family": {"type": "number"},
                },
                "required": ["professional", "sports", "arts", "travel", "culinary", "family"],
            },
        },
        "required": ["summary", "key_benefits", "target_keywords", "persona_category_weights"],
    },
}


def _anthropic_to_openai_tool(tool: dict) -> dict:
    """Anthropic tool_use 스키마 → OpenAI function calling 스키마 변환."""
    return {
        "type": "function",
        "function": {
            "name": tool["name"],
            "description": tool.get("description", ""),
            "parameters": tool["input_schema"],
        },
    }


def _input_mode_prefix(input_mode: str) -> str:
    """입력 모드별 user message prefix — selling_points 추출 시 hallucination 방지.

    문제: 약관 분석용 system 프롬프트가 짧은 카피·컨셉 입력을 받으면 LLM이 상상으로
    가짜 보장 항목(만기환급·특약·보험료 등)을 만들어내 분석 전체가 오염됨.
    대응: 카피·컨셉 모드일 때는 user message 앞에 "추측 금지" 가드를 명시적으로 추가.
    """
    if input_mode == "marketing":
        return (
            "**입력 형태: 마케팅 카피·광고 문구입니다.**\n"
            "카피는 짧으므로 약관에 있을 법한 보장 한도·특약·만기·보험료·가입 연령 등 "
            "명시되지 않은 정보는 모두 null 또는 빈 배열로 두세요. "
            "카피의 정서적 톤·암시된 타겟·후킹 포인트(예: '안심', '여성', '24시간')만 "
            "target_keywords와 카테고리 가중치에 반영하세요. "
            "summary는 '카피의 메시지를 한 줄로 요약'이지, '카피가 가리키는 상품 스펙'이 아닙니다.\n\n"
            "[카피 본문]\n"
        )
    if input_mode == "concept":
        return (
            "**입력 형태: 신상품 컨셉·핵심 보장 요약입니다.**\n"
            "요약에 명시된 항목만 인용하고, 명시되지 않은 상세 스펙(특약 한도, 갱신 주기, "
            "면책 등)은 만들지 마세요.\n\n"
            "[컨셉 요약]\n"
        )
    # terms: 기본 동작 (가드 prefix 없음)
    return ""


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def extract_selling_points(
    product_text: str,
    provider: LLMProvider = DEFAULT_PROVIDER,
    input_mode: str = "terms",
) -> SellingPoints:
    """상품 분석 → SellingPoints. get_llm_service() 위임.

    input_mode("terms" | "marketing" | "concept")에 따라 LLM이 hallucination 없이
    카피·컨셉 입력의 본질만 추출하도록 user message에 가드 prefix가 prepend된다.
    """
    return get_llm_service(provider).extract_selling_points(product_text, input_mode)


# ============================================================
# 임베딩 (OpenAI)
# ============================================================

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def _embed_text_uncached(text: str) -> np.ndarray:
    """OpenAI 임베딩 API 직접 호출 (캐시 미적용)."""
    res = openai_client().embeddings.create(model=EMBED_MODEL, input=[text])
    return np.asarray(res.data[0].embedding, dtype=np.float32)


# per-key lock — 동일 query 동시 miss 시 OpenAI 중복 호출 방지.
# WeakValueDictionary로 미사용 lock은 자동 GC → 무한 증가 없음.
_embed_key_locks: "weakref.WeakValueDictionary[str, threading.Lock]" = (
    weakref.WeakValueDictionary()
)
_embed_keys_guard = threading.Lock()


def _get_embed_lock(key: str) -> threading.Lock:
    """key별 lock 획득. dict 자체는 약참조라 호출자가 strong ref 유지 필요."""
    with _embed_keys_guard:
        lock = _embed_key_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _embed_key_locks[key] = lock
        return lock


def embed_text(text: str) -> list[float]:
    """text → 1536d 임베딩. (model, text) 단위 영속 캐시 적용.

    캐시 hit 시 OpenAI 호출 0회 (200~500ms 절감).
    동일 query 동시 miss 시 per-key lock으로 OpenAI 중복 호출 방지.
    리턴 타입은 호환성 위해 list[float] 유지 — 호출자가 np.array로 변환.
    """
    key = embed_cache.cache_key(EMBED_MODEL, text)
    # 1차 조회 — fast path (hit 시 lock 획득 안 함)
    cached = embed_cache.get(key)
    if cached is not None:
        return cached.tolist()

    # 동시 miss 직렬화 — 같은 key는 한 번만 OpenAI 호출
    per_key_lock = _get_embed_lock(key)
    with per_key_lock:
        # double-check: lock 대기 중 다른 요청이 채웠을 수 있음
        cached = embed_cache.get(key)
        if cached is not None:
            return cached.tolist()
        arr = _embed_text_uncached(text)
        embed_cache.put(key, arr)
        return arr.tolist()


# ============================================================
# 자연어 → 메타 필터 추출 (Claude Haiku tool_use)
# ============================================================

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
        "자연과학·수학·통계", "농림·수산·수의", "기타",
    ],
    "military_status": ["비현역", "현역"],
}

_QUERY_FILTER_EXTRACT_TOOL = {
    "name": "extract_persona_filter",
    "description": (
        "사용자의 자연어 페르소나 검색 쿼리에서 인구통계 메타 조건을 추출합니다. "
        "명시되지 않은 필드는 null/빈 배열로 두세요."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "sex": {
                "type": "array",
                "items": {"type": "string", "enum": ["남자", "여자"]},
                "description": (
                    "성별 단서가 있을 때만 채움. 예: '워킹맘/엄마/할머니/아내' → ['여자'], "
                    "'아빠/할아버지/남편/형/오빠' → ['남자']. 중성적이면 빈 배열."
                ),
            },
            "age_min": {
                "type": ["integer", "null"],
                "description": "'30대' → 30, '40~50대' → 40. 명시 없으면 null.",
            },
            "age_max": {
                "type": ["integer", "null"],
                "description": "'30대' → 39, '40~50대' → 59. 명시 없으면 null.",
            },
            "provinces": {
                "type": "array",
                "items": {"type": "string", "enum": _PROVINCE_ENUM},
                "description": (
                    "지역명. '수도권' → ['서울','경기','인천'], '영남권' → ['부산','대구','울산','경북','경남'], "
                    "'호남권' → ['광주','전남','전북'], '충청권' → ['대전','세종','충남','충북']. "
                    "구체 시는 그대로 매핑 (예: '서울' → ['서울'])."
                ),
            },
            "marital_statuses": {
                "type": "array",
                "items": {"type": "string", "enum": _MARITAL_ENUM},
                "description": (
                    "**명시적 혼인 단서가 있을 때만** 채움. "
                    "혼인 단서로 인정: '기혼/유부/결혼한' → ['배우자있음']; "
                    "'미혼/싱글' → ['미혼']; "
                    "'이혼/이혼한' → ['이혼']; "
                    "'사별/사별한/홀로된' → ['사별']; "
                    "'한부모/편부/편모' → ['이혼','사별']. "
                    "**혼인 단서가 아닌 단어 (절대 채우지 말 것)**: "
                    "'워킹맘/엄마/아빠/부부/부모/육아/맘/대디' 등 — 이들은 has_children=true로만 처리. "
                    "(이유: 미혼 자녀양육은 has_children=true로 이미 가능한 한 배제되며, "
                    "혼인상태까지 추측하면 AND 누적으로 매칭 0이 자주 발생)"
                ),
            },
            "has_children": {
                "type": ["boolean", "null"],
                "description": (
                    "자녀 양육 중임이 함의될 때만 true. "
                    "예: '워킹맘/아빠/엄마/부모/자녀 있는/육아' → true. "
                    "'미혼/혼자/싱글/은퇴자/학생' → false. "
                    "단서 없으면 null."
                ),
            },
            "occupations": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "직업명 키워드 (occupation 컬럼 부분 매칭, 여러 키워드는 OR로 결합). "
                    "데이터셋의 실제 occupation은 KSCO 표준 명칭 — 예: '중식 조리사', '한식 조리사', "
                    "'경리 사무원', '건물 경비원', '마케팅 전문가', '보육교사', '회계 사무원', '온라인 쇼핑 판매원'. "
                    "중요 규칙:\n"
                    "1) 복합어는 단어 단위로 분리해 모두 포함: '중식조리' → ['중식','조리'], 'IT 개발자' → ['개발자','IT']\n"
                    "2) '조리원'이 아닌 '조리사'가 데이터에 흔함 — 짧고 일반적인 어근('조리','의사','교사')을 우선 선택\n"
                    "3) '직장인/회사원/샐러리맨' 같은 추상 단어는 occupations에 넣지 말고 employment_status='employed'\n"
                    "4) '한식/중식/일식/양식' 같은 음식 종류는 직업과 결합되므로 occupations에 포함 OK"
                ),
            },
            "employment_status": {
                "type": ["string", "null"],
                "enum": ["employed", "unemployed", None],
                "description": (
                    "고용 상태 단서가 있을 때만 채움. "
                    "'직장인/회사원/일하는/직업 있는/샐러리맨/근로자' → 'employed' (직업 있음, 무직 제외). "
                    "'무직/실업/실직/구직 중' → 'unemployed'. "
                    "'은퇴' 자체는 employed가 아님 (occupation='무직' 케이스 많음) → 'unemployed' 추정 가능. "
                    "단서 없으면 null."
                ),
            },
            "education_levels": {
                "type": "array",
                "items": {"type": "string", "enum": _EDUCATION_ENUM},
                "description": "학력 단서가 명시될 때만 (예: '대졸', '대학원'). 일반 단어는 빈 배열.",
            },
            "additional_filters": {
                "type": "object",
                "description": (
                    "위의 명시 필드(sex/age/marital/has_children/employment/provinces/occupations/education_levels) "
                    "외의 데이터셋 컬럼에 대한 조건. 키는 데이터셋 컬럼명, 값은 매칭할 값 배열. "
                    "허용 컬럼·값은 시스템 프롬프트의 '동적 컬럼 스키마' 참조. "
                    "예: {'housing_type': ['아파트'], 'bachelors_field': ['공학·제조·건설']}. "
                    "단서가 없으면 빈 객체 {}."
                ),
                "additionalProperties": {
                    "type": "array",
                    "items": {"type": "string"},
                },
            },
            "remaining_query": {
                "type": "string",
                "description": (
                    "메타 조건으로 추출되지 **않은** 잔여 의미·라이프스타일 텍스트 (임베딩 매칭용). "
                    "**중요**: 메타 필드(sex/age/marital/has_children/employment/occupations/education_levels/provinces/additional_filters)로 "
                    "이미 흡수된 단어는 **반드시 제외**. 같은 의미를 메타+임베딩에서 이중 적용하면 매칭 0이 발생함. "
                    "흡수 판정 예시: "
                    "'워킹맘' → sex=여자 + has_children=true + employment=employed로 완전 흡수 → 빈 문자열. "
                    "'30대 서울 직장인' → age+province+employment로 완전 흡수 → 빈 문자열. "
                    "'은퇴 후 독서를 즐기는 60대' → age는 흡수, employment는 부분 흡수, '독서' 의미는 잔여 → '독서'. "
                    "메타에 들어가지 않은 라이프스타일/취향/가치관 단어만 남길 것. 흡수 후 남는 의미가 없으면 빈 문자열."
                ),
            },
        },
        "required": [
            "sex", "provinces", "marital_statuses", "occupations",
            "education_levels", "remaining_query",
        ],
    },
}

def _build_extract_system_prompt() -> str:
    """시스템 프롬프트 생성 — 동적 컬럼 스키마를 표로 인라인."""
    dyn_lines = []
    for col, values in _DYNAMIC_COLUMNS_SCHEMA.items():
        dyn_lines.append(f"  - {col}: {values}")
    dyn_table = "\n".join(dyn_lines)

    return f"""당신은 자연어 페르소나 검색 쿼리를 분석하여 인구통계 필터로 분해하는 도구입니다.
한국어 단어의 사회·문화적 함의를 적극 활용하세요.

## 명시 필드 (스키마에 있는 필드)
- sex: ['남자','여자']
- age_min, age_max: int (예: '30대' → 30, 39)
- provinces: 17개 시도 (예: '수도권' → ['서울','경기','인천'])
- marital_statuses: ['미혼','배우자있음','사별','이혼']
- has_children: bool (자녀 양육 중인지)
- employment_status: 'employed' | 'unemployed'
- occupations: KSCO 구체 직업명 키워드 ('의사','교사','개발자' 등)
- education_levels: ['무학','초등학교','중학교','고등학교','2~3년제 전문대학','4년제 대학교','대학원']

## 동적 컬럼 (additional_filters로 처리)
명시 필드 외에 데이터셋에는 다음 컬럼이 있습니다. 단서가 있으면 additional_filters에
column_name: [values] 형태로 추가하세요.

{dyn_table}

자유 키워드 컬럼:
  - district: 252개 시군구 (예: '서울-강남구', '경기-수원시'). 시군구 단서가 명확할 때만 사용.

## 매핑 예시

예시 1: '30대 워킹맘 수도권 아파트 거주'
  → sex=['여자'], age_min=30, age_max=39, provinces=['서울','경기','인천'],
    marital_statuses=[], has_children=true,
    employment_status='employed',
    additional_filters={{'housing_type': ['아파트']}},
    remaining_query=''
  ※ '워킹맘'은 혼인 단서가 아니므로 marital_statuses는 비움.
    has_children=true가 이미 미혼을 자연 배제하므로 추가 추측 불필요.
    '워킹맘'은 sex+has_children+employment로 완전 흡수되었으므로 remaining_query는 빈 문자열.

예시 1-b: '30대 기혼 직장맘'
  → sex=['여자'], age_min=30, age_max=39,
    marital_statuses=['배우자있음'], has_children=true,
    employment_status='employed',
    remaining_query=''
  ※ '기혼'은 명시적 혼인 단서이므로 marital_statuses=['배우자있음'] 채움.

예시 1-c: '40대 한부모 가장'
  → age_min=40, age_max=49,
    marital_statuses=['이혼','사별'], has_children=true,
    remaining_query='가장'
  ※ '한부모'는 명시적 단서 (이혼 또는 사별 가정).

예시 2: '월세 사는 20대 청년'
  ⚠ housing_type에 '월세'는 없음 — '주택 이외의 거처' 등 다른 값으로 추정 어려우면 추가하지 않음.
  → age_min=20, age_max=29, additional_filters={{}},
    remaining_query='월세 사는 청년'

예시 3: '공대 출신 30대 IT 개발자'
  → age_min=30, age_max=39, employment_status='employed', occupations=['개발자'],
    additional_filters={{'bachelors_field': ['공학·제조·건설','정보통신기술']}},
    remaining_query=''

예시 4: '현역 군인 20대'
  → age_min=20, age_max=29,
    additional_filters={{'military_status': ['현역']}},
    remaining_query=''

예시 5: '강남에 사는 30대 전문직'
  → age_min=30, age_max=39, employment_status='employed',
    additional_filters={{'district': ['서울-강남구','서울-서초구']}},
    remaining_query='전문직'
  ※ '전문직'은 employment_status='employed'에 부분 흡수되지만 직군 의미가 남으므로 보존
    (임베딩으로 의사·변호사·교수 같은 페르소나를 좁히는 데 사용).

## 핵심 규칙
- '직장인/회사원/샐러리맨' 같은 추상 단어 → employment_status='employed' (occupations에 넣지 않기)
- '의사/교사/개발자/판매원' 같은 KSCO 구체 직업명 → occupations
- **복합 직업 키워드는 단어 단위로 분리해 모두 occupations에 포함**:
  - '중식조리' → occupations=['중식', '조리']  (각각 부분 매칭으로 '중식 조리사' 등이 잡힘)
  - 'IT 개발자' → occupations=['개발자', 'IT']
  - '한식 조리사' → occupations=['한식', '조리']
- '조리원'이 아니라 '조리사'가 데이터에 흔함 — 짧은 어근('조리')을 선호하면 부분 매칭 폭이 넓어짐
- additional_filters는 시스템 프롬프트에 명시된 값(enum)만 정확히 사용
- 데이터셋에 없는 값이면 additional_filters에 넣지 말고 remaining_query에 남기기
- 추측 금지 — 텍스트에 단서가 명확할 때만 채웁니다
"""


_QUERY_FILTER_EXTRACT_SYSTEM = _build_extract_system_prompt()


def _fill_extract_defaults(data: dict, query: str) -> dict:
    """추출 결과 누락 필드 기본값 채우기."""
    data.setdefault("sex", [])
    data.setdefault("age_min", None)
    data.setdefault("age_max", None)
    data.setdefault("provinces", [])
    data.setdefault("marital_statuses", [])
    data.setdefault("has_children", None)
    data.setdefault("occupations", [])
    data.setdefault("employment_status", None)
    data.setdefault("education_levels", [])
    data.setdefault("additional_filters", {})
    data.setdefault("remaining_query", query)
    return data


@retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=1, max=4))
def extract_filter_from_query(
    query: str, provider: LLMProvider = DEFAULT_PROVIDER,
) -> dict:
    """자연어 쿼리 → 메타 필터 dict. get_llm_service() 위임."""
    return get_llm_service(provider).extract_filter_from_query(query)


# ============================================================
# 페르소나 가상 응답 생성 (설문 시뮬레이션)
# ============================================================

_PERSONA_ANSWER_SYSTEM = (
    "당신은 주어진 페르소나의 입장에서 일관된 가치관·말투·소비성향을 유지하며 설문에 답하는 도구입니다.\n"
    "추측이나 캐릭터 깨기 없이 페르소나 프로필에 충실하게 답변하세요. "
    "객관식은 반드시 제공된 선택지 중 하나(또는 다중선택의 경우 여러 개)만 골라야 합니다. "
    "척도형은 정수, 주관식은 200자 이내의 짧은 텍스트로 답합니다.\n"
    "reasoning은 50자 이내로 왜 그렇게 답했는지 페르소나 관점에서 간단히 설명. "
    "confidence는 0.0~1.0 사이 자신감 점수."
)


def _build_answer_tool_schema(question_type: str, options: list[str] | None,
                               scale_min: int | None, scale_max: int | None) -> dict:
    """질문 유형별 answer_value 스키마를 동적으로 구성.

    - single_choice/nps/scale: 단일 값
    - multi_choice: 배열
    - open_ended: 자유 텍스트
    """
    # answer 필드 type 분기
    if question_type == "single_choice":
        answer_schema = {
            "type": "string",
            "enum": options or [],
            "description": "제공된 선택지 중 정확히 하나의 텍스트를 그대로 반환",
        }
    elif question_type == "multi_choice":
        answer_schema = {
            "type": "array",
            "items": {"type": "string", "enum": options or []},
            "minItems": 1,
            "description": "선택지 중 1개 이상 (배열)",
        }
    elif question_type == "scale":
        answer_schema = {
            "type": "integer",
            "minimum": scale_min if scale_min is not None else 0,
            "maximum": scale_max if scale_max is not None else 10,
            "description": f"{scale_min}~{scale_max} 사이 정수",
        }
    elif question_type == "nps":
        answer_schema = {
            "type": "integer",
            "minimum": 0,
            "maximum": 10,
            "description": "0(전혀 추천 안 함)~10(매우 추천) 정수",
        }
    else:  # open_ended
        answer_schema = {
            "type": "string",
            "maxLength": 300,
            "description": "200자 이내 자유 텍스트 답변",
        }

    return {
        "name": "submit_answer",
        "description": "페르소나의 답변을 구조화된 JSON으로 제출합니다.",
        "input_schema": {
            "type": "object",
            "properties": {
                "answer": answer_schema,
                "reasoning": {
                    "type": "string",
                    "maxLength": 100,
                    "description": "50자 이내, 이 페르소나가 그렇게 답한 이유",
                },
                "confidence": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                    "description": "0.0~1.0 자신감 점수",
                },
            },
            "required": ["answer", "reasoning", "confidence"],
        },
    }


def _build_answer_prompt(
    profile: str,
    survey_objective: str,
    question_text: str,
    question_type: str,
    options: list[str] | None,
    scale_min: int | None,
    scale_max: int | None,
    scale_label_low: str | None,
    scale_label_high: str | None,
) -> str:
    """페르소나 답변 프롬프트 빌드 (사용자 메시지)."""
    parts = [
        "[페르소나 프로필]",
        profile,
        "",
    ]
    if survey_objective:
        parts += ["[설문 맥락]", survey_objective, ""]
    parts += ["[질문]", question_text, ""]

    if question_type in ("single_choice", "multi_choice"):
        parts += ["[선택지]"]
        for i, opt in enumerate(options or [], 1):
            parts.append(f"  {i}. {opt}")
        parts.append("")
        parts.append(
            "위 페르소나의 입장에서 가장 적합한 선택지를 골라 submit_answer로 제출하세요."
        )
    elif question_type == "scale":
        low = scale_label_low or "낮음"
        high = scale_label_high or "높음"
        parts.append(
            f"척도: {scale_min}({low}) ~ {scale_max}({high}) 사이 정수로 답하세요."
        )
    elif question_type == "nps":
        parts.append(
            "NPS: 0(전혀 추천 안 함) ~ 10(매우 추천) 정수로 답하세요."
        )
    else:  # open_ended
        parts.append(
            "200자 이내 자유 텍스트로 답하세요. 페르소나의 말투·관점을 유지."
        )

    return "\n".join(parts)


@retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=1, max=4))
def generate_persona_answer(
    *,
    profile: str,
    survey_objective: str,
    question_text: str,
    question_type: str,
    options: list[str] | None,
    scale_min: int | None,
    scale_max: int | None,
    scale_label_low: str | None,
    scale_label_high: str | None,
    provider: LLMProvider,
    model: str,
    temperature: float,
) -> tuple[dict, int]:
    """단일 페르소나 × 단일 질문 → get_llm_service() 위임."""
    return get_llm_service(provider).generate_persona_answer(
        profile=profile,
        survey_objective=survey_objective,
        question_text=question_text,
        question_type=question_type,
        options=options,
        scale_min=scale_min,
        scale_max=scale_max,
        scale_label_low=scale_label_low,
        scale_label_high=scale_label_high,
        model=model,
        temperature=temperature,
    )


# ============================================================
# 설문 질문 자동 추천 (Claude Haiku tool_use)
# ============================================================

_SUGGEST_QUESTIONS_SYSTEM = """당신은 설문 전문가입니다. 주어진 설문 제목·목적·대상자 정보를 바탕으로
응답자가 답하기 쉽고 분석 가치가 높은 질문 5개를 만들어주세요.

설계 원칙:
- 다양한 유형을 균형있게 섞기 (단일 선택 1-2개 + 척도 1개 + NPS 1개 + 주관식 1개)
- 객관식 선택지는 상호 배타적이고 망라적(MECE)이도록
- 척도는 1-5 또는 1-7 사이로
- 질문은 한국어, 자연스러운 문장, 30-100자 이내
- 대상 페르소나가 실제로 답할 수 있는 구체성

피해야 할 것:
- 너무 추상적인 질문 ("당신의 인생관은?")
- 유도 질문 ("당연히 X를 좋아하시죠?")
- 두 가지를 한 번에 묻는 더블 바렐 질문
"""

_SUGGEST_QUESTIONS_TOOL = {
    "name": "submit_suggested_questions",
    "description": "설문에 추가할 추천 질문 목록을 제출합니다.",
    "input_schema": {
        "type": "object",
        "properties": {
            "questions": {
                "type": "array",
                "minItems": 3,
                "maxItems": 8,
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {
                            "type": "string",
                            "enum": ["single_choice", "multi_choice", "scale", "open_ended", "nps"],
                        },
                        "text": {
                            "type": "string",
                            "minLength": 5,
                            "maxLength": 200,
                        },
                        "options": {
                            "type": "array",
                            "items": {"type": "string", "maxLength": 100},
                            "description": "single_choice/multi_choice일 때만. 2-7개 권장. 다른 유형은 빈 배열.",
                        },
                        "scale_min": {
                            "type": ["integer", "null"],
                            "minimum": 0,
                            "maximum": 9,
                        },
                        "scale_max": {
                            "type": ["integer", "null"],
                            "minimum": 1,
                            "maximum": 10,
                        },
                        "scale_label_low": {
                            "type": ["string", "null"],
                            "maxLength": 20,
                        },
                        "scale_label_high": {
                            "type": ["string", "null"],
                            "maxLength": 20,
                        },
                        "required": {"type": "boolean"},
                    },
                    "required": ["type", "text", "options", "required"],
                },
            },
        },
        "required": ["questions"],
    },
}


def _build_suggest_user_prompt(
    title: str,
    description: str,
    objective: str,
    target_summary: str,
    num: int,
    existing_question_texts: list[str] | None = None,
) -> str:
    parts = [
        f"[설문 제목]\n{title or '(미입력)'}",
        "",
    ]
    if description:
        parts += [f"[설명]\n{description}", ""]
    if objective:
        parts += [f"[조사 목적]\n{objective}", ""]
    if target_summary:
        parts += [f"[대상자 정보]\n{target_summary}", ""]
    if existing_question_texts:
        parts += [
            "[이미 작성된 질문 — 중복 피해주세요]",
            "\n".join(f"- {q}" for q in existing_question_texts),
            "",
        ]
    parts.append(
        f"위 정보를 바탕으로, 분석 가치가 높은 질문 {num}개를 다양한 유형으로 만들어 "
        f"submit_suggested_questions 도구로 제출하세요."
    )
    return "\n".join(parts)


def _normalize_suggested_questions(qs: list[dict]) -> list[dict]:
    """추천 질문 누락 필드 기본값 + nps/scale 정합성 보정."""
    for q in qs:
        q.setdefault("options", [])
        q.setdefault("scale_min", None)
        q.setdefault("scale_max", None)
        q.setdefault("scale_label_low", None)
        q.setdefault("scale_label_high", None)
        q.setdefault("required", True)
        if q.get("type") == "nps":
            q["scale_min"] = 0
            q["scale_max"] = 10
        elif q.get("type") == "scale":
            if q.get("scale_min") is None:
                q["scale_min"] = 1
            if q.get("scale_max") is None:
                q["scale_max"] = 5
    return qs


@retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=1, max=4))
def generate_survey_questions(
    *,
    title: str,
    description: str,
    objective: str,
    target_summary: str,
    num: int = 5,
    existing_question_texts: list[str] | None = None,
    provider: LLMProvider = DEFAULT_PROVIDER,
) -> list[dict]:
    """설문 제목·목적·대상 → 추천 질문. get_llm_service() 위임."""
    return get_llm_service(provider).generate_survey_questions(
        title=title,
        description=description,
        objective=objective,
        target_summary=target_summary,
        num=num,
        existing_question_texts=existing_question_texts,
    )


# ============================================================
# 리포트 생성 (Claude Haiku)
# ============================================================

def _format_context_for_report(
    sp: SellingPoints,
    top_personas: list[PersonaHit],
    population: PopulationStats,
) -> str:
    """리포트 컨텍스트.

    핵심 변경: '상위 50명 카드'가 아니라 **100만 행 전체에서 산출한 타겟층 5만 명**의
    인구통계 분포를 기반으로 LLM이 인사이트를 쓰게 한다. 카드 상위 페르소나는
    참고용 정성 샘플로만 5명 제공.
    """
    # cohort 요약
    core = next(c for c in population.cohorts if c.name == "core")
    target = next(c for c in population.cohorts if c.name == "target")
    interest = next(c for c in population.cohorts if c.name == "interest")
    cohort_block = (
        f"- 전체 스코어링 인구: {population.total_scored:,}명\n"
        f"- 핵심 타겟(상위 0.5%): {core.size:,}명 (점수 ≥ {core.min_score:.1f}, 평균 {core.avg_score:.1f})\n"
        f"- 타겟층(상위 5%): {target.size:,}명 (점수 ≥ {target.min_score:.1f}, 평균 {target.avg_score:.1f})\n"
        f"- 관심층(상위 20%): {interest.size:,}명 (점수 ≥ {interest.min_score:.1f}, 평균 {interest.avg_score:.1f})"
    )

    # demographics — 컬럼별로 라벨·카운트·점유율 (타겟층 5만 명 기준)
    # 점유율 < 0.5%인 미세 빈은 컨텍스트에서 제외 (토큰 절약 + LLM 주의 집중)
    target_size = target.size or 1
    MIN_PCT = 0.5
    demo_blocks: list[str] = []
    for g in population.demographics:
        rows: list[str] = []
        for b in g.bins:
            pct = (b.count / target_size) * 100.0
            if pct < MIN_PCT:
                continue
            rows.append(f"  - {b.label}: {b.count:,}명 ({pct:.1f}%)")
        if not rows:
            continue
        suffix = (
            f" (Top {g.truncated_to} / 전체 {g.total_unique}분류)"
            if g.truncated_to
            else ""
        )
        demo_blocks.append(f"### {g.label}{suffix}\n" + "\n".join(rows))

    # 정성 샘플 — 상위 5명만 (이름은 빼고 인구통계 위주)
    sample_lines: list[str] = []
    for p in top_personas[:5]:
        edu = p.education_level or ""
        family = p.family_type or ""
        sample_lines.append(
            f"- {p.sex} {p.age}세 · {p.province} {p.district} · "
            f"{p.occupation} · {edu} · {family} · 점수 {p.score:.1f}"
        )

    return (
        "## 상품 소구점\n"
        f"- 요약: {sp.summary}\n"
        f"- 핵심 혜택: {', '.join(sp.key_benefits)}\n"
        f"- 키워드: {', '.join(sp.target_keywords)}\n"
        f"- 카테고리 가중치: {json.dumps(sp.persona_category_weights, ensure_ascii=False)}\n"
        "\n## Cohort 규모 (전체 100만 명 중)\n"
        + cohort_block
        + "\n\n## 타겟층 5만 명 인구통계 분포 (Nemotron 전 컬럼)\n"
        + "\n\n".join(demo_blocks)
        + "\n\n## 정성 샘플: 핵심 타겟 상위 5명 (이름 비공개)\n"
        + "\n".join(sample_lines)
    )


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def generate_report(
    sp: SellingPoints,
    top_personas: list[PersonaHit],
    population: PopulationStats,
    provider: LLMProvider = DEFAULT_PROVIDER,
) -> str:
    """FP/기획자용 마크다운 리포트 (모집단 기반). get_llm_service() 위임."""
    return get_llm_service(provider).generate_report(sp, top_personas, population)


# ============================================================
# 설문 차트 리포트 총평 생성 (Claude Haiku)
#
# 입력 stats는 dict로 받음 — routes/survey_report.py의 ReportResponse를 services 레이어가
# 의존하지 않도록 약식 결합. 호출자가 통계를 추출해 넘기는 책임.
# 기대 키: survey(title, objective, question_count, persona_count, status),
#         summary(total_completed, total_failed, total_tokens, avg_response_seconds),
#         distribution(sex, age_bins, province_top),
#         questions[{order, type, text, total_responses, avg_confidence,
#                    choice_distribution?, scale_mean?, scale_histogram?,
#                    open_ended_samples?}]
# ============================================================

def _format_context_for_commentary(stats: dict) -> str:
    """설문 통계 dict → LLM user 컨텍스트 텍스트."""
    lines: list[str] = []
    sv = stats.get("survey", {})
    sm = stats.get("summary", {})
    dist = stats.get("distribution", {})
    questions = stats.get("questions", []) or []

    lines.append("## 설문 메타")
    lines.append(f"- 제목: {sv.get('title', '')}")
    if sv.get("objective"):
        lines.append(f"- 목적: {sv['objective']}")
    lines.append(
        f"- 요청 페르소나 {sv.get('persona_count', 0)}명 / 질문 {sv.get('question_count', 0)}개 / "
        f"상태 {sv.get('status', '')}"
    )

    lines.append("\n## 응답 요약")
    completed = sm.get("total_completed", 0)
    failed = sm.get("total_failed", 0)
    asked = sv.get("persona_count", 0) or (completed + failed) or 1
    rate = completed / asked * 100.0 if asked else 0.0
    lines.append(
        f"- 완료 {completed}명 / 실패 {failed}명 (완료율 {rate:.1f}%)"
    )
    if sm.get("avg_response_seconds") is not None:
        lines.append(f"- 평균 응답 시간 {sm['avg_response_seconds']:.1f}초")
    if sm.get("total_tokens"):
        lines.append(f"- 누적 토큰 {sm['total_tokens']:,}")

    # 응답자 분포 — 점유율도 함께
    if dist:
        lines.append("\n## 응답자 분포")
        sex = dist.get("sex") or {}
        if sex:
            sex_parts = [
                f"{k} {v}명({v / completed * 100:.0f}%)" if completed else f"{k} {v}명"
                for k, v in sex.items()
            ]
            lines.append(f"- 성별: {', '.join(sex_parts)}")
        age_bins = dist.get("age_bins") or []
        if age_bins:
            age_parts = [
                f"{b['label']} {b['count']}명" for b in age_bins if b.get("count", 0) > 0
            ]
            if age_parts:
                lines.append(f"- 연령대: {', '.join(age_parts)}")
        prov_top = dist.get("province_top") or []
        if prov_top:
            prov_parts = [f"{name} {cnt}명" for name, cnt in prov_top]
            lines.append(f"- 시도 Top: {', '.join(prov_parts)}")

    # 질문별 통계
    lines.append("\n## 질문별 통계")
    for q in questions:
        lines.append(
            f"\n### Q{q.get('order', '?')}. [{q.get('type', '')}] {q.get('text', '')}"
        )
        lines.append(
            f"- 응답 {q.get('total_responses', 0)}건 / 평균 confidence {q.get('avg_confidence', 0):.2f}"
        )
        qtype = q.get("type")
        if qtype in ("single_choice", "multi_choice"):
            choices = q.get("choice_distribution") or {}
            total = sum(choices.values()) or 1
            for opt, cnt in sorted(choices.items(), key=lambda x: -x[1]):
                lines.append(f"  - {opt}: {cnt}명 ({cnt / total * 100:.1f}%)")
        elif qtype in ("scale", "nps"):
            if q.get("scale_mean") is not None:
                lines.append(
                    f"  - 평균 {q['scale_mean']:.2f} / 중앙값 {q.get('scale_median', 0):.1f}"
                )
            for bin_ in q.get("scale_histogram") or []:
                if bin_.get("count", 0) > 0:
                    label_suffix = f" ({bin_['label']})" if bin_.get("label") else ""
                    lines.append(f"  - {bin_['score']}{label_suffix}: {bin_['count']}명")
        elif qtype == "open_ended":
            samples = q.get("open_ended_samples") or []
            if q.get("open_ended_length_avg") is not None:
                lines.append(
                    f"  - 평균 길이 {q['open_ended_length_avg']:.0f}자 / "
                    f"최대 {q.get('open_ended_length_max', 0)}자"
                )
            for s in samples[:8]:
                # 한 줄로 잘라 컨텍스트 절약
                ans = (s.get("answer") or "").replace("\n", " ").strip()
                if len(ans) > 160:
                    ans = ans[:160] + "…"
                lines.append(f"  - {ans}")

    return "\n".join(lines)


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def generate_overall_commentary(
    stats: dict,
    provider: LLMProvider = DEFAULT_PROVIDER,
) -> str:
    """설문 차트 리포트 최상단 총평 마크다운 생성. get_llm_service() 위임."""
    return get_llm_service(provider).generate_overall_commentary(stats)


# ============================================================
# LLM 다형성 추상 레이어 (BaseLLMService & 구현체)
# ============================================================

class BaseLLMService(ABC):
    """LLM 추상화용 Base 서비스 클래스."""

    @abstractmethod
    def extract_selling_points(
        self, product_text: str, input_mode: str = "terms"
    ) -> SellingPoints:
        pass

    @abstractmethod
    def extract_filter_from_query(self, query: str) -> dict:
        pass

    @abstractmethod
    def generate_persona_answer(
        self,
        *,
        profile: str,
        survey_objective: str,
        question_text: str,
        question_type: str,
        options: list[str] | None,
        scale_min: int | None,
        scale_max: int | None,
        scale_label_low: str | None,
        scale_label_high: str | None,
        model: str,
        temperature: float,
    ) -> tuple[dict, int]:
        pass

    @abstractmethod
    def generate_survey_questions(
        self,
        *,
        title: str,
        description: str,
        objective: str,
        target_summary: str,
        num: int = 5,
        existing_question_texts: list[str] | None = None,
    ) -> list[dict]:
        pass

    @abstractmethod
    def generate_report(
        self,
        sp: SellingPoints,
        top_personas: list[PersonaHit],
        population: PopulationStats,
    ) -> str:
        pass

    @abstractmethod
    def generate_overall_commentary(self, stats: dict) -> str:
        pass


class AnthropicLLMService(BaseLLMService):
    """Anthropic Claude API 기반 LLM 서비스 구현."""

    def extract_selling_points(
        self, product_text: str, input_mode: str = "terms"
    ) -> SellingPoints:
        truncated = product_text[:MAX_PRODUCT_TEXT_CHARS]
        user_content = _input_mode_prefix(input_mode) + truncated
        msg = anthropic_client().messages.create(
            model=CLAUDE_SONNET,
            max_tokens=1500,
            system=SELLING_POINTS_PROMPT,
            tools=[_SELLING_POINTS_TOOL],
            tool_choice={"type": "tool", "name": "record_selling_points"},
            messages=[{"role": "user", "content": user_content}],
        )
        for block in msg.content:
            if block.type == "tool_use" and block.name == "record_selling_points":
                return SellingPoints.model_validate(block.input)
        raise RuntimeError(f"Claude tool_use 응답 누락. content={msg.content!r}")

    def extract_filter_from_query(self, query: str) -> dict:
        msg = anthropic_client().messages.create(
            model=CLAUDE_HAIKU,
            max_tokens=400,
            system=_QUERY_FILTER_EXTRACT_SYSTEM,
            tools=[_QUERY_FILTER_EXTRACT_TOOL],
            tool_choice={"type": "tool", "name": "extract_persona_filter"},
            messages=[{"role": "user", "content": query}],
        )
        for block in msg.content:
            if block.type == "tool_use" and block.name == "extract_persona_filter":
                return _fill_extract_defaults(dict(block.input), query)
        raise RuntimeError(f"Claude tool_use 응답 누락. content={msg.content!r}")

    def generate_persona_answer(
        self,
        *,
        profile: str,
        survey_objective: str,
        question_text: str,
        question_type: str,
        options: list[str] | None,
        scale_min: int | None,
        scale_max: int | None,
        scale_label_low: str | None,
        scale_label_high: str | None,
        model: str,
        temperature: float,
    ) -> tuple[dict, int]:
        tool = _build_answer_tool_schema(question_type, options, scale_min, scale_max)
        user_prompt = _build_answer_prompt(
            profile=profile,
            survey_objective=survey_objective,
            question_text=question_text,
            question_type=question_type,
            options=options,
            scale_min=scale_min,
            scale_max=scale_max,
            scale_label_low=scale_label_low,
            scale_label_high=scale_label_high,
        )
        msg = anthropic_client().messages.create(
            model=model,
            max_tokens=400,
            temperature=temperature,
            system=_PERSONA_ANSWER_SYSTEM,
            tools=[tool],
            tool_choice={"type": "tool", "name": "submit_answer"},
            messages=[{"role": "user", "content": user_prompt}],
        )
        tokens = msg.usage.input_tokens + msg.usage.output_tokens
        for block in msg.content:
            if block.type == "tool_use" and block.name == "submit_answer":
                return dict(block.input), tokens
        raise RuntimeError(f"Claude submit_answer 누락. content={msg.content!r}")

    def generate_survey_questions(
        self,
        *,
        title: str,
        description: str,
        objective: str,
        target_summary: str,
        num: int = 5,
        existing_question_texts: list[str] | None = None,
    ) -> list[dict]:
        user_prompt = _build_suggest_user_prompt(
            title=title,
            description=description,
            objective=objective,
            target_summary=target_summary,
            num=num,
            existing_question_texts=existing_question_texts,
        )
        msg = anthropic_client().messages.create(
            model=CLAUDE_HAIKU,
            max_tokens=1500,
            system=_SUGGEST_QUESTIONS_SYSTEM,
            tools=[_SUGGEST_QUESTIONS_TOOL],
            tool_choice={"type": "tool", "name": "submit_suggested_questions"},
            messages=[{"role": "user", "content": user_prompt}],
        )
        for block in msg.content:
            if block.type == "tool_use" and block.name == "submit_suggested_questions":
                data = dict(block.input)
                qs: list[dict] = data.get("questions", []) or []
                return _normalize_suggested_questions(qs)
        raise RuntimeError(f"Claude tool_use 응답 누락. content={msg.content!r}")

    def generate_report(
        self,
        sp: SellingPoints,
        top_personas: list[PersonaHit],
        population: PopulationStats,
    ) -> str:
        context = _format_context_for_report(sp, top_personas, population)
        msg = anthropic_client().messages.create(
            model=CLAUDE_HAIKU,
            max_tokens=1600,
            system=REPORT_PROMPT,
            messages=[{"role": "user", "content": context}],
        )
        parts = [b.text for b in msg.content if getattr(b, "type", None) == "text"]
        return "\n".join(parts).strip()

    def generate_overall_commentary(self, stats: dict) -> str:
        context = _format_context_for_commentary(stats)
        msg = anthropic_client().messages.create(
            model=CLAUDE_HAIKU,
            max_tokens=900,
            system=COMMENTARY_PROMPT,
            messages=[{"role": "user", "content": context}],
        )
        parts = [b.text for b in msg.content if getattr(b, "type", None) == "text"]
        return "\n".join(parts).strip()


class SLLMService(BaseLLMService):
    """OpenAI 호환 sLLM vLLM API 기반 LLM 서비스 구현."""

    def extract_selling_points(
        self, product_text: str, input_mode: str = "terms"
    ) -> SellingPoints:
        truncated = product_text[:MAX_PRODUCT_TEXT_CHARS]
        user_content = _input_mode_prefix(input_mode) + truncated
        completion = sllm_client().chat.completions.create(
            model=SLLM_MODEL,
            max_tokens=1500,
            temperature=0.2,
            messages=[
                {"role": "system", "content": SELLING_POINTS_PROMPT},
                {"role": "user", "content": user_content},
            ],
            tools=[_anthropic_to_openai_tool(_SELLING_POINTS_TOOL)],
            tool_choice={"type": "function", "function": {"name": "record_selling_points"}},
        )
        message = completion.choices[0].message
        if not message.tool_calls:
            raise RuntimeError(f"sLLM tool_calls 누락. content={message.content!r}")
        args_json = message.tool_calls[0].function.arguments
        try:
            args = json.loads(args_json)
        except json.JSONDecodeError as e:
            raise RuntimeError(f"sLLM tool args JSON 파싱 실패: {args_json!r}") from e
        return SellingPoints.model_validate(args)

    def extract_filter_from_query(self, query: str) -> dict:
        completion = sllm_client().chat.completions.create(
            model=SLLM_MODEL,
            max_tokens=400,
            temperature=0.2,
            messages=[
                {"role": "system", "content": _QUERY_FILTER_EXTRACT_SYSTEM},
                {"role": "user", "content": query},
            ],
            tools=[_anthropic_to_openai_tool(_QUERY_FILTER_EXTRACT_TOOL)],
            tool_choice={"type": "function", "function": {"name": "extract_persona_filter"}},
        )
        msg = completion.choices[0].message
        if not msg.tool_calls:
            raise RuntimeError(f"sLLM tool_calls 누락. {msg!r}")
        args = json.loads(msg.tool_calls[0].function.arguments)
        return _fill_extract_defaults(args, query)

    def generate_persona_answer(
        self,
        *,
        profile: str,
        survey_objective: str,
        question_text: str,
        question_type: str,
        options: list[str] | None,
        scale_min: int | None,
        scale_max: int | None,
        scale_label_low: str | None,
        scale_label_high: str | None,
        model: str,
        temperature: float,
    ) -> tuple[dict, int]:
        tool = _build_answer_tool_schema(question_type, options, scale_min, scale_max)
        user_prompt = _build_answer_prompt(
            profile=profile,
            survey_objective=survey_objective,
            question_text=question_text,
            question_type=question_type,
            options=options,
            scale_min=scale_min,
            scale_max=scale_max,
            scale_label_low=scale_label_low,
            scale_label_high=scale_label_high,
        )
        completion = sllm_client().chat.completions.create(
            model=model,
            max_tokens=400,
            temperature=temperature,
            messages=[
                {"role": "system", "content": _PERSONA_ANSWER_SYSTEM},
                {"role": "user", "content": user_prompt},
            ],
            tools=[_anthropic_to_openai_tool(tool)],
            tool_choice={"type": "function", "function": {"name": "submit_answer"}},
        )
        msg = completion.choices[0].message
        tokens = (completion.usage.prompt_tokens + completion.usage.completion_tokens
                  if completion.usage else 0)
        if not msg.tool_calls:
            raise RuntimeError(f"sLLM tool_calls 누락. {msg!r}")
        args = json.loads(msg.tool_calls[0].function.arguments)
        return args, tokens

    def generate_survey_questions(
        self,
        *,
        title: str,
        description: str,
        objective: str,
        target_summary: str,
        num: int = 5,
        existing_question_texts: list[str] | None = None,
    ) -> list[dict]:
        user_prompt = _build_suggest_user_prompt(
            title=title,
            description=description,
            objective=objective,
            target_summary=target_summary,
            num=num,
            existing_question_texts=existing_question_texts,
        )
        completion = sllm_client().chat.completions.create(
            model=SLLM_MODEL,
            max_tokens=1500,
            temperature=0.4,
            messages=[
                {"role": "system", "content": _SUGGEST_QUESTIONS_SYSTEM},
                {"role": "user", "content": user_prompt},
            ],
            tools=[_anthropic_to_openai_tool(_SUGGEST_QUESTIONS_TOOL)],
            tool_choice={"type": "function", "function": {"name": "submit_suggested_questions"}},
        )
        msg = completion.choices[0].message
        if not msg.tool_calls:
            raise RuntimeError(f"sLLM tool_calls 누락. {msg!r}")
        args = json.loads(msg.tool_calls[0].function.arguments)
        qs = args.get("questions", []) or []
        return _normalize_suggested_questions(qs)

    def generate_report(
        self,
        sp: SellingPoints,
        top_personas: list[PersonaHit],
        population: PopulationStats,
    ) -> str:
        context = _format_context_for_report(sp, top_personas, population)
        completion = sllm_client().chat.completions.create(
            model=SLLM_MODEL,
            max_tokens=1600,
            temperature=0.4,
            messages=[
                {"role": "system", "content": REPORT_PROMPT},
                {"role": "user", "content": context},
            ],
        )
        return (completion.choices[0].message.content or "").strip()

    def generate_overall_commentary(self, stats: dict) -> str:
        context = _format_context_for_commentary(stats)
        completion = sllm_client().chat.completions.create(
            model=SLLM_MODEL,
            max_tokens=900,
            temperature=0.4,
            messages=[
                {"role": "system", "content": COMMENTARY_PROMPT},
                {"role": "user", "content": context},
            ],
        )
        return (completion.choices[0].message.content or "").strip()


# 팩토리 매핑 싱글톤
_SERVICES: dict[LLMProvider, BaseLLMService] = {
    "anthropic": AnthropicLLMService(),
    "sllm": SLLMService(),
}


def get_llm_service(provider: LLMProvider = DEFAULT_PROVIDER) -> BaseLLMService:
    """LLM 프로바이더별 객체 인스턴스 팩토리."""
    if provider not in _SERVICES:
        raise ValueError(f"지원하지 않는 LLM 프로바이더: {provider}")
    return _SERVICES[provider]
