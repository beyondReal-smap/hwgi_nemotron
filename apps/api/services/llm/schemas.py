"""LLM tool_use 스키마 정의 + 프롬프트 빌더 + 컨텍스트 포매터.

provider(anthropic/sllm) 무관한 순수 데이터·헬퍼만 모은다. 실제 API 호출은 service.py.
"""

from __future__ import annotations

import json

from models.schemas import PersonaHit, PopulationStats, SellingPoints

from .config import (
    _DYNAMIC_COLUMNS_SCHEMA,
    _EDUCATION_ENUM,
    _MARITAL_ENUM,
    _PROVINCE_ENUM,
)

# ============================================================
# 소구점 추출 (Claude Sonnet + tool_use)
# ============================================================

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
            "**입력 형태: 마케팅 카피·광고 문구입니다.**\n카피에 명시되지 않은 보장 한도·특약·만기·보험료·가입 연령은 절대 만들지 말고 모두 null 또는 빈 배열로 두세요.\n카피에서 읽히는 것은 정서적 톤·암시된 타겟·후킹 포인트뿐이며, 이것만 target_keywords와 카테고리 가중치에 반영하세요.\n- ✗ \"여성의 모든 순간을 …\" → summary \"여성 생애주기 통합 보장 종신보험\" (가짜 스펙)\n- ✓ \"여성의 모든 순간을 …\" → summary \"여성의 일상 전반을 함께한다는 정서적 메시지의 카피\"\n\n[카피 본문]\n"
        )
    if input_mode == "concept":
        return (
            "**입력 형태: 신상품 컨셉·핵심 보장 요약입니다.**\n요약에 명시된 항목만 인용하고, 명시되지 않은 보장 한도·특약·만기·보험료·가입 연령은 절대 만들지 말고 모두 null 또는 빈 배열로 두세요.\n- ✗ 요약에 \"실손 특약\" 한 줄만 있는데 → 특약 한도·갱신 주기·면책을 임의 생성\n- ✓ 요약에 적힌 보장명만 그대로 인용, 나머지 상세 스펙은 null/빈 배열\n\n[컨셉 요약]\n"
        )
    # terms: 기본 동작 (가드 prefix 없음)
    return ""


# ============================================================
# 자연어 → 메타 필터 추출 (Claude Haiku tool_use)
# ============================================================

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
                    "1) 복합어는 단어 단위로 분리해 모두 포함: "
                    "'중식조리' → ['중식','조리'], 'IT 개발자' → ['개발자','IT']\n"
                    "2) '조리원'이 아닌 '조리사'가 데이터에 흔함 — "
                    "짧고 일반적인 어근('조리','의사','교사')을 우선 선택\n"
                    "3) '직장인/회사원/샐러리맨' 같은 추상 단어는 occupations에 넣지 말고 "
                    "employment_status='employed'\n"
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
                    "**중요**: 메타 필드("
                    "sex/age/marital/has_children/employment/occupations/education_levels/provinces/additional_filters"
                    ")로 이미 흡수된 단어는 **반드시 제외**. "
                    "같은 의미를 메타+임베딩에서 이중 적용하면 매칭 0이 발생함. "
                    "흡수 판정 예시: "
                    "'워킹맘' → sex=여자 + has_children=true + employment=employed로 완전 흡수 → 빈 문자열. "
                    "'30대 서울 직장인' → age+province+employment로 완전 흡수 → 빈 문자열. "
                    "'은퇴 후 독서를 즐기는 60대' → age는 흡수, employment는 부분 흡수, "
                    "'독서' 의미는 잔여 → '독서'. "
                    "메타에 들어가지 않은 라이프스타일/취향/가치관 단어만 남길 것. "
                    "흡수 후 남는 의미가 없으면 빈 문자열."
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

### 혼인 단서 판정 (예시 1 계열)

예시 1: '30대 워킹맘 수도권 아파트 거주'
  → sex=['여자'], age_min=30, age_max=39, provinces=['서울','경기','인천'],
    marital_statuses=[], has_children=true,
    employment_status='employed',
    additional_filters={{'housing_type': ['아파트']}},
    remaining_query=''
  ※ '워킹맘'은 혼인 단서가 아니므로 marital_statuses는 비움.
    has_children=true가 이미 미혼을 자연 배제하므로 추가 추측 불필요.
    '워킹맘'은 sex+has_children+employment로 완전 흡수 → remaining_query는 빈 문자열.
  ✓ marital_statuses=[]
  ✗ marital_statuses=['배우자있음']  ('워킹맘'을 혼인으로 추측하면 AND 누적으로 매칭 0)

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

### additional_filters · 흡수 판정 (예시 2 계열)

예시 2: '월세 사는 20대 청년'
  ⚠ housing_type에 '월세'는 없음 — '주택 이외의 거처' 등 다른 값으로 추정 어려우면 추가하지 않음.
  → age_min=20, age_max=29, additional_filters={{}},
    remaining_query='월세 사는 청년'

예시 3: '공대 출신 30대 IT 개발자'
  → age_min=30, age_max=39, employment_status='employed', occupations=['개발자'],
    additional_filters={{'bachelors_field': ['공학·제조·건설','정보통신기술']}},
    remaining_query=''
  ※ '공대 출신'은 bachelors_field로 완전 흡수 → 잔여 없음.

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

예시 6: '부모와 함께 사는 20대'
  → age_min=20, age_max=29,
    remaining_query='부모와 함께 사는'
  ※ 동거/혼자 거주 단서는 additional_filters로 채우지 말고 remaining_query에 남길 것.
    (이 단서는 별도 코드가 원문에서 직접 읽어 처리하므로, 흡수하면 신호가 사라짐.)

## 핵심 규칙

매핑 규칙:
- '직장인/회사원/샐러리맨' 같은 추상 단어 → employment_status='employed' (occupations에 넣지 않기)
- '의사/교사/개발자/판매원' 같은 KSCO 구체 직업명 → occupations
- **복합 직업 키워드는 단어 단위로 분리해 모두 occupations에 포함**:
  - '중식조리' → occupations=['중식', '조리']  (각각 부분 매칭으로 '중식 조리사' 등이 잡힘)
  - 'IT 개발자' → occupations=['개발자', 'IT']
  - '한식 조리사' → occupations=['한식', '조리']
  - ✓ '중식조리' → ['중식','조리']    ✗ '의사' → ['의','사']  (단일 직업어는 분리하지 않음)
- '조리원'이 아니라 '조리사'가 데이터에 흔함 — 짧은 어근('조리')을 선호하면 부분 매칭 폭이 넓어짐
- additional_filters는 시스템 프롬프트에 명시된 값(enum)만 정확히 사용
- '완전 흡수'(의미가 메타 필드에 전부 들어감)면 remaining_query에서 제외, '부분 흡수'(직군·취향 등 잔여 의미가 남음)면 잔여 텍스트만 remaining_query에 보존

하지 마세요:
- remaining_query 이중적용 금지 — 메타 필드로 흡수된 단어는 remaining_query에서 **반드시 제외** (메타+임베딩 이중 적용 시 매칭 0)
- 데이터셋에 없는 값은 additional_filters에 넣지 말고 remaining_query에 남기기
- 동적 컬럼 스키마에 없는 키(예: family_types)를 additional_filters에 만들지 말 것 — 동거/혼자 단서는 remaining_query에 남기기
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


# ============================================================
# 페르소나 가상 응답 생성 (설문 시뮬레이션)
# ============================================================

_PERSONA_ANSWER_SYSTEM = """당신은 주어진 페르소나의 입장에서 일관된 가치관·말투·소비성향을 유지하며 설문에 답하는 도구입니다.

규칙:
- 추측이나 캐릭터 깨기 없이 페르소나 프로필에 충실하게 답변합니다.
- 객관식은 반드시 제공된 선택지의 텍스트를 그대로 골라야 합니다(다중선택은 1개 이상). 선택지에 없는 답이나 변형은 금지합니다.
- 척도형·NPS는 주어진 범위 안의 정수, 주관식은 200자 이내의 짧은 텍스트로 답합니다.
- reasoning은 50자 이내로 그렇게 답한 이유를 페르소나 관점에서 설명합니다. confidence는 0.0~1.0 사이 자신감 점수입니다.

예시(객관식):
✓ 선택지가 [매우 만족, 만족, 보통]일 때 answer로 "만족"을 그대로 반환
✗ "꽤 만족" 같은 변형, 또는 척도 범위를 벗어난 값 반환

submit_answer 도구만 호출하고 그 외 텍스트는 출력하지 마세요.
"""


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


# ============================================================
# 설문 질문 자동 추천 (Claude Haiku tool_use)
# ============================================================

_SUGGEST_QUESTIONS_SYSTEM = """당신은 설문 전문가입니다. 주어진 설문 제목·목적·대상자 정보를 바탕으로
응답자가 답하기 쉽고 분석 가치가 높은 질문을 요청된 개수만큼 만들어주세요.

설계 원칙:
- 요청된 개수에 맞추되, 여러 유형을 균형있게 섞기. 가능하면 척도·NPS·주관식을 각 1개 이상 포함하고, 나머지는 단일 선택으로 채우기
- 복수 응답이 자연스러운 항목(예: 가입한 보험 종류)에만 다중 선택 사용
- 객관식 선택지는 상호 배타적이고 망라적(MECE)이도록. 객관식만 선택지 2-7개, 그 외 유형은 선택지를 빈 배열로
- 척도는 1-5 또는 1-7 사이로, 양 끝 의미를 라벨로 채우기 (예: 매우 불만족 ← → 매우 만족)
- 질문은 한국어, 자연스러운 문장, 대략 30-100자 권장
- 대상 페르소나가 실제로 답할 수 있는 구체성
- 기존 질문이 주어지면 의미가 겹치지 않게 새 관점으로

예시:
- 더블 바렐: ✗ "가격과 보장 범위에 만족하시나요?" → ✓ "가격에 만족하시나요?" / "보장 범위에 만족하시나요?" (한 번에 한 가지만)
- MECE 선택지: ✗ ["20대", "직장인", "기타"] (기준이 섞이고 겹침) → ✓ ["20대 이하", "30대", "40대", "50대 이상"] (한 기준으로 겹침·누락 없이)
- 유도 질문: ✗ "이 상품이 당연히 유리하죠?" → ✓ "이 상품의 보장 수준을 어떻게 평가하시나요?" (중립적으로)

피해야 할 것:
- 너무 추상적인 질문 ("당신의 인생관은?")
- 유도 질문 ("당연히 X를 좋아하시죠?")
- 두 가지를 한 번에 묻는 더블 바렐 질문
- 기존 질문과 의미가 중복되는 질문
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


# ============================================================
# 리포트 / 총평 컨텍스트 포매터 (Claude Haiku)
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
    # cohort 요약 — mode에 따라 라벨을 분기해 LLM에 정확한 컷 의미 전달
    # absolute: 점수 컷이 의미 있게 적중 (예: 점수 ≥75인 인원이 525명)
    # percentile: 컷 인원이 부족하거나 과다해 모집단 분포 기반 폴백 (의미 약화)
    core = next(c for c in population.cohorts if c.name == "core")
    target = next(c for c in population.cohorts if c.name == "target")
    interest = next(c for c in population.cohorts if c.name == "interest")

    def _ck(label_base: str, c) -> str:
        if c.mode == "absolute":
            cut_label = f"점수 ≥{c.threshold_absolute:.0f} 절대 컷"
        else:
            cut_label = f"상위 {c.percentile}% 폴백(절대 컷 결과가 적절치 않아 분위수로 재산정)"
        return (
            f"- {label_base}: {c.size:,}명 "
            f"({cut_label}, min={c.min_score:.1f}, 평균={c.avg_score:.1f})"
        )

    cohort_block = (
        f"- 전체 스코어링 인구: {population.total_scored:,}명\n"
        f"{_ck('핵심 타겟', core)}\n"
        f"{_ck('타겟층', target)}\n"
        f"{_ck('관심층', interest)}"
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


def _format_context_for_commentary(stats: dict) -> str:
    """설문 통계 dict → LLM user 컨텍스트 텍스트.

    입력 stats는 dict로 받음 — routes/survey_report.py의 ReportResponse를 services 레이어가
    의존하지 않도록 약식 결합. 호출자가 통계를 추출해 넘기는 책임.
    기대 키: survey(title, objective, question_count, persona_count, status),
            summary(total_completed, total_failed, total_tokens, avg_response_seconds),
            distribution(sex, age_bins, province_top),
            questions[{order, type, text, total_responses, avg_confidence,
                       choice_distribution?, scale_mean?, scale_histogram?,
                       open_ended_samples?}]
    """
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
