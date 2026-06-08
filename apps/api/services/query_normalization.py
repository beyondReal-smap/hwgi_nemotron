"""자연어 검색 쿼리 정규화 헬퍼 (페르소나 탐색 초고도화).

설계 목표: **어떤 자연어 조건이 들어와도 정확히 좁혀 검색**되게 한다.

핵심 결함(이전): LLM이 내놓는 카테고리/값이 데이터셋 실제값과 다르면 isin 매칭 0 →
폴백이 '메타 전체 해제'로 떨어져 연령·지역 같은 멀쩡한 제약까지 버렸다.
(예: occupation 'IT'/'생산직'/'농부'/'군인' → KSCO 실제 직업명에 없어 0매칭;
     family_type '1인 가구' → 실제값은 '혼자 거주'.)

해결 4축 (전부 코드 정규화 = LLM보다 신뢰):
  1) 동의어→실제값 매핑(가구/혼인/지역/학력/전공) — 데이터셋 실제값만 타깃.
  2) 직업 카테고리 → KSCO 실제 직업명 부분매칭 어근 배열로 확장.
  3) 생애역할(대학생/취준생/은퇴자 등) → 연령+고용 다중필드 규칙.
  4) 값 스내핑(snap_to_valid): LLM 추출값을 실제값에 검증/치환, 미일치는 드롭+임베딩 강등 → isin 0 구조적 차단.
  + 점진적 폴백(progressive_fallback): 0명일 때 약→강 순으로 하나씩만 풀어 메타 보존.

모든 매핑 타깃은 data/personas_1m.parquet 실측값(레지스트리)만 사용한다.
"""

from __future__ import annotations

import re

# ============================================================
# 가구 형태(family_type) — has_children / 1인가구 코드 매핑 (기존 유지)
# ============================================================

CHILD_FAMILY_TYPES: list[str] = [
    "배우자·손자녀와 거주",
    "배우자·자녀·부모와 거주",
    "배우자·자녀·아버지와 거주",
    "배우자·자녀·어머니와 거주",
    "배우자·자녀·형제자매와 거주",
    "배우자·자녀와 거주",
    "손자녀와 거주",
    "자녀·아버지와 거주",
    "자녀·어머니와 거주",
    "자녀와 거주 (배우자 별거)",
    "자녀와 거주 (한부모)",
]

NO_CHILD_FAMILY_TYPES: list[str] = [
    "4세대이상",
    "가구주+기타친인척",
    "기타1세대",
    "기타2세대",
    "기타3세대",
    "배우자·미혼 형제자매와 거주",
    "배우자·부모와 거주",
    "배우자·친인척과 거주",
    "배우자·편부모와 거주",
    "배우자·형제자매와 거주",
    "배우자와 거주",
    "부 또는 모와 거주",
    "부모·조모와 동거",
    "부모·조부모와 동거",
    "부모·조부와 동거",
    "부모·친인척과 동거",
    "부모·형제자매와 동거",
    "부모와 동거",
    "비친족 동거",
    "아버지와 동거",
    "어머니와 동거",
    "조부 또는 조모와 동거",
    "조부모와 동거",
    "친인척과 거주",
    "형제 부부 가구에 동거",
    "형제자매와 동거 (가구주)",
    "혼자 거주",
    "혼자 거주 (배우자 별거)",
]

NON_SOLO_FAMILY_TYPES: list[str] = [
    *CHILD_FAMILY_TYPES,
    *[ft for ft in NO_CHILD_FAMILY_TYPES if not ft.startswith("혼자 거주")],
]

# 1인가구(독거)에 해당하는 데이터셋 실제 family_type 값. 데이터셋에 "1인 가구" 라벨은
# 없고 "혼자 거주"로 표기됨 → '1인가구/혼자/독거/싱글' 단서를 이 값으로 매핑해야 매칭된다.
SOLO_FAMILY_TYPES: list[str] = ["혼자 거주", "혼자 거주 (배우자 별거)"]

_SOLO_CUES = ("혼자", "1인", "1인가구", "싱글", "독신", "독거", "나홀로")
_COHABITATION_CUES = ("동거", "함께사는", "같이사는", "가족과", "부모와", "배우자와", "자녀와")

# 부모와 동거(캥거루족/본가) → 단일 부모 동거 3종으로 정밀 매핑.
# 데이터의 '부모와 동거/어머니와 동거/아버지와 동거'는 모두 '동거'로 끝나고,
# 다세대 복합형('배우자·자녀·부모와 거주' 등)은 '거주'를 써서 자연 분리된다.
# 부정 룩비하인드로 '조부모'(외/친조부모 포함)·'시부모/시어머니/시아버지'를 배제해
# 조부모·시부모 동거가 부모 동거로 오매핑되는 것을 막는다.
PARENT_COHAB_FAMILY_TYPES: list[str] = ["부모와 동거", "어머니와 동거", "아버지와 동거"]

_PARENT_COHAB_RE = re.compile(
    r"(?:(?<!조)부모님?|(?<![시조])(?:어머니|엄마|모친)|(?<![시조])(?:아버지|아빠|부친))"
    r"(?:와|과|랑)?"
    r"(?:동거|함께사|같이사|함께살|같이살|같이지내|모시)"
    r"|본가살이|본가에서|본가생활|본가살"
)


def _parent_cohabitation_hint(query: str | None) -> bool:
    """쿼리가 '부모(조부모·시부모 제외) 동거'를 명시했는지. 공백 무시 매칭."""
    return bool(_PARENT_COHAB_RE.search((query or "").replace(" ", "")))


def family_types_for_has_children(has_children: bool | None, query: str | None = None) -> list[str]:
    """has_children·1인가구 단서를 데이터셋 family_type 목록으로 바꾼다.

    - has_children True/False → 자녀 동거/비동거 family_type 집합.
    - '1인가구/혼자/독거/싱글' 단서가 있고 동거 단서가 없으면 → 혼자 거주로 양성 제한.
    """
    q = (query or "").replace(" ", "")
    solo_hint = any(cue in q for cue in _SOLO_CUES)
    cohabitation_hint = any(cue in q for cue in _COHABITATION_CUES)

    # '부모와 동거'는 자녀 동거 여부와 무관한 구체 가구 구조 → has_children 기반 broad
    # 매핑(NON_SOLO 37종 등)보다 우선해 단일 부모 동거 3종으로 정밀화한다.
    if _parent_cohabitation_hint(query):
        return list(PARENT_COHAB_FAMILY_TYPES)

    if has_children is True:
        return list(CHILD_FAMILY_TYPES)
    if has_children is False:
        if solo_hint and not cohabitation_hint:
            return list(SOLO_FAMILY_TYPES)
        family_types = list(NO_CHILD_FAMILY_TYPES)
        if cohabitation_hint and not solo_hint:
            family_types = [ft for ft in family_types if not ft.startswith("혼자 거주")]
        return family_types
    if solo_hint and not cohabitation_hint:
        return list(SOLO_FAMILY_TYPES)
    if cohabitation_hint and not solo_hint:
        return list(NON_SOLO_FAMILY_TYPES)
    return []


# ============================================================
# 세대 슬랭 → 연령 범위 + 잔여 텍스트 정리 (기존 유지)
# ============================================================

# 세대 표현 → 연령 범위 (2026 기준 통용 범위).
_GENERATION_AGE: list[tuple[tuple[str, ...], int, int]] = [
    (("mz세대", "엠지세대", "mz"), 20, 44),
    (("z세대", "잘파", "젠지", "genz"), 19, 29),
    (("밀레니얼", "m세대", "엠세대"), 30, 45),
    (("x세대", "엑스세대"), 46, 56),
    (("베이비부머", "베이비붐"), 60, 74),
    (("청년", "청춘"), 19, 34),
    (("실버세대", "노년층", "고령층", "어르신", "시니어"), 65, 99),
]


def age_range_for_generation(query: str | None) -> tuple[int | None, int | None]:
    """세대 슬랭(MZ/Z/밀레니얼/X/베이비부머/청년/실버)을 연령 범위로. 없으면 (None, None)."""
    q = (query or "").replace(" ", "").lower()
    for cues, lo, hi in _GENERATION_AGE:
        if any(c in q for c in cues):
            return lo, hi
    return None, None


# 코드가 메타로 흡수한 단서. 임베딩 잔여 텍스트에 남으면 메타+임베딩 이중 필터링으로
# 0매칭이 발생하므로 흡수 시 잔여에서 제거한다. (긴 토큰 먼저)
_GENERATION_TERMS = (
    "MZ세대", "엠지세대", "MZ", "Z세대", "잘파", "젠지",
    "밀레니얼", "M세대", "엠세대", "엑스세대", "X세대",
    "베이비부머", "베이비붐", "청년", "청춘",
    "실버세대", "노년층", "고령층", "어르신", "시니어",
)
_SOLO_TERMS = ("1인가구", "1인 가구", "나홀로", "독거", "독신", "싱글", "혼자 거주", "혼자", "1인")


def strip_absorbed_terms(text: str, *, drop_generation: bool, drop_solo: bool) -> str:
    """메타로 흡수된 세대/1인가구 단서를 잔여 텍스트에서 제거하고 공백을 정리한다."""
    out = text or ""
    terms: list[str] = []
    if drop_generation:
        terms += _GENERATION_TERMS
    if drop_solo:
        terms += _SOLO_TERMS
    for t in terms:
        out = out.replace(t, "")
    return " ".join(out.split())


# 가구/지역/혼인/학력 동의어가 메타로 흡수됐을 때 잔여에 남는 일반 표현 접미사.
# 이들이 잔여에 남으면 임베딩 임계 컷이 발동해 결과가 과소해진다(예: '지방 거주자' → 3건).
_PHRASING_STOP = (
    "거주자", "거주중", "사시는", "거주", "사는", "사람", "살이",
    "종사자", "출신", "계열", "분야", "직군", "근무",
)


def _strip_phrasing(remaining: str | None, query: str | None) -> str:
    """동의어로 흡수된 가구/지역/혼인/학력/전공 단서 + 일반 접미사를 잔여에서 제거.

    메타가 이미 그 조건을 좁혔으므로 잔여에 남기면 임베딩 이중 필터링(과컷)만 유발한다.
    제거할 게 없으면 원문(공백 보존)을 그대로 돌려 의미 잔여의 임베딩 품질을 지킨다.
    """
    if not remaining:
        return remaining or ""
    qz = (query or "").replace(" ", "").lower()
    cues: set[str] = set()
    for table in (HOUSEHOLD_SYNONYMS, MARITAL_SYNONYMS, REGION_SYNONYMS):
        cues |= {c for c in table if c.lower() in qz}
    for table in (EDUCATION_SYNONYMS, BACHELORS_FIELD_SYNONYMS):
        for syns in table.values():
            cues |= {s for s in syns if s.replace(" ", "").lower() in qz}

    collapsed = remaining.replace(" ", "")
    changed = False
    for c in sorted(cues, key=len, reverse=True):
        if c and c in collapsed:
            collapsed = collapsed.replace(c, "")
            changed = True
    for s in _PHRASING_STOP:
        if s in collapsed:
            collapsed = collapsed.replace(s, "")
            changed = True
    return collapsed.strip() if changed else remaining


# ============================================================
# 데이터셋 실제값 레지스트리 (SSOT — isin 검증용 화이트리스트)
# ============================================================

VALID_VALUES: dict[str, set[str]] = {
    "sex": {"여자", "남자"},
    "marital_status": {"배우자있음", "미혼", "사별", "이혼"},
    "education_level": {
        "고등학교", "4년제 대학교", "2~3년제 전문대학",
        "중학교", "초등학교", "대학원", "무학",
    },
    "housing_type": {
        "아파트", "단독주택", "다세대주택",
        "주택 이외의 거처", "연립주택", "비주거용 건물 내 주택",
    },
    "bachelors_field": {
        "해당없음", "공학·제조·건설", "경영·행정·법", "예술·인문",
        "보건·복지", "교육", "정보통신기술", "서비스",
        "사회과학·언론", "자연과학·수학", "농림어업·수의학",
    },
    "military_status": {"비현역", "현역"},
    "province": {
        "경기", "서울", "부산", "경남", "인천", "경북", "대구", "충남",
        "전남", "전북", "충북", "강원", "대전", "광주", "울산", "제주", "세종",
    },
    "family_type": {*CHILD_FAMILY_TYPES, *NO_CHILD_FAMILY_TYPES},
}

# LLM이 흔히 내놓는 근사 값 → 데이터셋 실제값 (snap의 2차 보정. 단일값).
SYNONYM_MAPS: dict[str, dict[str, str]] = {
    "sex": {
        "남성": "남자", "여성": "여자", "남": "남자", "여": "여자",
        "male": "남자", "female": "여자",
    },
    # family_type 값 단일 동의어 (SellingPoints.target_family_types 등 '값'으로 들어올 때).
    # 다중값이 필요한 표현(대가족 등)은 snap_category_values가 HOUSEHOLD_SYNONYMS로 폴백.
    "family_type": {
        "부부": "배우자와 거주", "신혼": "배우자와 거주", "신혼부부": "배우자와 거주",
        "딩크": "배우자와 거주", "딩크족": "배우자와 거주", "맞벌이부부": "배우자와 거주",
        "무자녀부부": "배우자와 거주",
        "1인 가구": "혼자 거주", "1인가구": "혼자 거주", "독거": "혼자 거주",
        "독신": "혼자 거주", "자취": "혼자 거주", "나홀로 가구": "혼자 거주",
        "핵가족": "배우자·자녀와 거주", "4인 가구": "배우자·자녀와 거주", "4인가구": "배우자·자녀와 거주",
        "한부모": "자녀와 거주 (한부모)", "편부모": "자녀와 거주 (한부모)",
        "조손": "손자녀와 거주", "조손가정": "손자녀와 거주",
    },
    "education_level": {
        "대졸": "4년제 대학교", "학사": "4년제 대학교", "4년제": "4년제 대학교",
        "대학교": "4년제 대학교", "대학": "4년제 대학교",
        "전문대졸": "2~3년제 전문대학", "전문대": "2~3년제 전문대학",
        "초대졸": "2~3년제 전문대학", "전문학사": "2~3년제 전문대학",
        "고졸": "고등학교", "중졸": "중학교", "초졸": "초등학교",
        "석사": "대학원", "박사": "대학원", "대학원졸": "대학원", "석박사": "대학원",
    },
    "bachelors_field": {
        "공대": "공학·제조·건설", "공학": "공학·제조·건설", "이공계": "공학·제조·건설",
        "제조": "공학·제조·건설", "건축": "공학·제조·건설", "토목": "공학·제조·건설",
        "IT": "정보통신기술", "전산": "정보통신기술", "컴퓨터": "정보통신기술",
        "소프트웨어": "정보통신기술", "정보통신": "정보통신기술",
        "상경": "경영·행정·법", "경영": "경영·행정·법", "경제": "경영·행정·법",
        "법학": "경영·행정·법", "행정": "경영·행정·법", "회계": "경영·행정·법",
        "문과": "예술·인문", "인문": "예술·인문", "예체능": "예술·인문",
        "예술": "예술·인문", "어문": "예술·인문",
        "보건": "보건·복지", "간호": "보건·복지", "복지": "보건·복지", "약대": "보건·복지",
        "사범": "교육", "교육학": "교육", "사범대": "교육",
        "사회과학": "사회과학·언론", "정치": "사회과학·언론", "언론": "사회과학·언론",
        "심리": "사회과학·언론",
        "자연과학": "자연과학·수학", "이과": "자연과학·수학", "수학": "자연과학·수학",
        "물리": "자연과학·수학", "화학": "자연과학·수학", "통계": "자연과학·수학",
        "농대": "농림어업·수의학", "농업": "농림어업·수의학",
        "수의대": "농림어업·수의학", "수산": "농림어업·수의학",
    },
    "housing_type": {
        "단독": "단독주택", "빌라": "다세대주택", "다세대": "다세대주택",
        "연립": "연립주택", "오피스텔": "주택 이외의 거처",
        "고시원": "주택 이외의 거처", "원룸": "주택 이외의 거처",
        # ⚠ '전세'/'월세'/'자가'는 점유형태(주택유형 아님) → 매핑 금지(드롭).
    },
    "marital_status": {
        "기혼": "배우자있음", "유부": "배우자있음", "결혼": "배우자있음",
        "싱글": "미혼", "비혼": "미혼",
        "돌싱": "이혼", "이혼남": "이혼", "이혼녀": "이혼",
        "홀로된": "사별", "사별한": "사별",
    },
    "military_status": {
        "군필": "비현역", "예비역": "비현역", "민방위": "비현역",
        "현역병": "현역", "복무중": "현역",
    },
}


# ============================================================
# 가구·혼인·지역 자연어 동의어 → 실제값(다중) 매핑
# ============================================================

HOUSEHOLD_SYNONYMS: dict[str, list[str]] = {
    # 1인가구/독거/자취
    "1인가구": SOLO_FAMILY_TYPES, "일인가구": SOLO_FAMILY_TYPES, "독거": SOLO_FAMILY_TYPES,
    "독거노인": ["혼자 거주"], "자취": ["혼자 거주"], "자취생": ["혼자 거주"],
    "나홀로": SOLO_FAMILY_TYPES, "혼삶": ["혼자 거주"], "싱글족": ["혼자 거주"],
    # 신혼/딩크 = 배우자 + 무자녀 = 부부만 거주
    "신혼": ["배우자와 거주"], "신혼부부": ["배우자와 거주"],
    "딩크": ["배우자와 거주"], "딩크족": ["배우자와 거주"], "무자녀부부": ["배우자와 거주"],
    # 핵가족/인원수(가구원수 컬럼 없음 → 표준 형태 근사)
    "핵가족": ["배우자·자녀와 거주"], "4인가구": ["배우자·자녀와 거주"], "사인가구": ["배우자·자녀와 거주"],
    "3인가구": ["배우자·자녀와 거주", "자녀와 거주 (한부모)"],
    # 대가족/다세대/3세대(직계 3세대 이상 동거로 근사)
    "대가족": [
        "배우자·자녀·부모와 거주", "배우자·자녀·어머니와 거주", "배우자·자녀·아버지와 거주",
        "배우자·손자녀와 거주", "기타3세대", "4세대이상",
        "부모·조부모와 동거", "부모·조부와 동거", "부모·조모와 동거",
    ],
    "다세대가구": [
        "배우자·자녀·부모와 거주", "배우자·자녀·어머니와 거주", "기타3세대", "4세대이상",
        "부모·조부모와 동거",
    ],
    "3세대": [
        "배우자·자녀·부모와 거주", "배우자·자녀·어머니와 거주", "배우자·자녀·아버지와 거주",
        "배우자·손자녀와 거주", "기타3세대", "부모·조부모와 동거",
    ],
    "삼세대": [
        "배우자·자녀·부모와 거주", "배우자·자녀·어머니와 거주", "기타3세대",
    ],
    "4세대": ["4세대이상"],
    # 한부모
    "한부모": ["자녀와 거주 (한부모)", "자녀·어머니와 거주", "자녀·아버지와 거주", "자녀와 거주 (배우자 별거)"],
    "편부모": ["자녀와 거주 (한부모)", "자녀·어머니와 거주", "자녀·아버지와 거주"],
    "싱글맘": ["자녀·어머니와 거주", "자녀와 거주 (한부모)"],
    "싱글대디": ["자녀·아버지와 거주", "자녀와 거주 (한부모)"],
    "미혼모": ["자녀·어머니와 거주", "자녀와 거주 (한부모)"],
    "미혼부": ["자녀·아버지와 거주", "자녀와 거주 (한부모)"],
    # 조손가정
    "조손가정": ["손자녀와 거주", "배우자·손자녀와 거주"], "조손": ["손자녀와 거주", "배우자·손자녀와 거주"],
    # 기러기(배우자·자녀와 잔류로 근사)
    "기러기": ["배우자·자녀와 거주"], "기러기아빠": ["배우자·자녀와 거주"], "기러기엄마": ["배우자·자녀와 거주"],
    # 부모와 동거(캥거루족)
    "캥거루족": ["부모와 동거", "어머니와 동거", "아버지와 동거"],
    "본가살이": ["부모와 동거", "어머니와 동거", "아버지와 동거"],
}

MARITAL_SYNONYMS: dict[str, list[str]] = {
    "기혼": ["배우자있음"], "결혼한": ["배우자있음"], "결혼": ["배우자있음"],
    "유부": ["배우자있음"], "유부남": ["배우자있음"], "유부녀": ["배우자있음"],
    "부부": ["배우자있음"], "신혼": ["배우자있음"], "신혼부부": ["배우자있음"],
    "딩크": ["배우자있음"], "딩크족": ["배우자있음"], "맞벌이부부": ["배우자있음"],
    "미혼": ["미혼"], "비혼": ["미혼"], "솔로": ["미혼"], "노총각": ["미혼"], "노처녀": ["미혼"],
    "이혼": ["이혼"], "돌싱": ["이혼"], "돌싱남": ["이혼"], "돌싱녀": ["이혼"],
    "이혼남": ["이혼"], "이혼녀": ["이혼"],
    "사별": ["사별"], "사별한": ["사별"], "홀로된": ["사별"], "미망인": ["사별"],
    "과부": ["사별"], "홀아비": ["사별"],
}

_ALL_PROVINCES: list[str] = [
    "경기", "서울", "부산", "경남", "인천", "경북", "대구", "충남",
    "전남", "전북", "충북", "강원", "대전", "광주", "울산", "제주", "세종",
]
_CAPITAL_AREA: list[str] = ["서울", "경기", "인천"]
_METRO_CITIES: list[str] = ["부산", "대구", "인천", "광주", "대전", "울산"]
_NON_CAPITAL = [p for p in _ALL_PROVINCES if p not in _CAPITAL_AREA]

REGION_SYNONYMS: dict[str, list[str]] = {
    "수도권": _CAPITAL_AREA, "비수도권": _NON_CAPITAL, "지방거주자": _NON_CAPITAL, "지방": _NON_CAPITAL,
    "광역시": _METRO_CITIES, "특별시": ["서울"], "특별자치시": ["세종"], "특별자치도": ["제주", "강원"],
    "영남권": ["부산", "대구", "울산", "경북", "경남"], "영남": ["부산", "대구", "울산", "경북", "경남"],
    "경상도": ["부산", "대구", "울산", "경북", "경남"], "경상": ["경북", "경남"],
    "호남권": ["광주", "전남", "전북"], "호남": ["광주", "전남", "전북"],
    "전라도": ["광주", "전남", "전북"], "전라": ["전남", "전북"],
    "충청권": ["대전", "세종", "충남", "충북"], "충청도": ["대전", "세종", "충남", "충북"],
    "충청": ["대전", "세종", "충남", "충북"], "관동": ["강원"],
    "제주도민": ["제주"], "서울시민": ["서울"], "서울사람": ["서울"], "부산시민": ["부산"],
    "부산사람": ["부산"], "경기도민": ["경기"], "인천시민": ["인천"], "대구시민": ["대구"],
    "광주시민": ["광주"], "대전시민": ["대전"], "울산시민": ["울산"],
    "경상남도": ["경남"], "경상북도": ["경북"], "충청남도": ["충남"], "충청북도": ["충북"],
    "전라남도": ["전남"], "전라북도": ["전북"], "경기도": ["경기"], "강원도": ["강원"],
    "강원특별자치도": ["강원"], "제주도": ["제주"], "제주특별자치도": ["제주"], "세종시": ["세종"],
}


def _apply_synonyms(query: str | None, table: dict[str, list[str]]) -> list[str]:
    """쿼리에서 동의어 단서를 찾아 실제값 집합(중복제거·순서보존)으로 반환.

    긴 key부터 검사하고 매칭된 단서는 쿼리에서 '소비'한다 — '비수도권'(14개)이
    그 안의 '수도권'(3개)까지 추가로 매칭해 17개로 오확장되는 것을 막는다.
    """
    q = (query or "").replace(" ", "").lower()
    hits: list[str] = []
    for cue in sorted(table.keys(), key=len, reverse=True):
        cl = cue.lower()
        if cl in q:
            q = q.replace(cl, " ")  # 소비: 부분 잔재 중복 매칭 차단
            for v in table[cue]:
                if v not in hits:
                    hits.append(v)
    return hits


# ============================================================
# 직업 카테고리 → KSCO 실제 직업명 부분매칭 어근 확장
#   (모든 어근은 occupation 실제값에 substring으로 존재함을 검증함)
# ============================================================

OCCUPATION_CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "it": ["개발자", "프로그래머", "소프트웨어", "정보 시스템", "정보 보안", "데이터", "네트워크", "웹"],
    "의료": ["의사", "간호", "약사", "치과", "한의", "임상", "물리치료", "방사선", "수의"],
    "교육": ["교사", "강사", "교수", "보육", "훈련"],
    "금융": ["은행", "증권", "금융", "보험", "투자", "신용"],
    "공무원": ["행정", "공무", "경찰", "소방", "세무", "관세"],
    "생산": ["조작원", "제조", "생산", "조립", "가공", "용접"],
    "농림어업": ["농업", "어업", "임업", "어부", "작물", "축산", "조경"],
    "군인": ["부사관", "장교", "병사", "육군", "해군", "공군"],
    "예술": ["디자이너", "작가", "화가", "연주", "공예", "사진가", "예술가", "배우", "가수", "성악", "국악"],
    "법률": ["변호사", "판사", "법무", "법률", "변리사"],
    "연구": ["연구원", "과학", "화학", "시험원"],
    "영업": ["영업", "판매원", "마케팅"],
    "운전": ["운전원", "택배", "기관사", "조종사", "집배원"],
    "건설": ["건설", "건축", "토목", "배관", "목공"],
    "요리": ["조리", "주방", "제빵", "제과", "바텐더"],
    "미용": ["미용", "피부", "메이크업", "이용사"],
    "경비": ["경비", "청소", "환경미화"],
    "사무": ["사무원", "회계", "총무", "비서", "경리"],
    "복지": ["사회복지", "요양", "돌봄", "간병", "보호사"],
    "언론": ["기자", "아나운서", "리포터", "출판", "방송"],
    "경영": ["임원", "경영", "관리자", "컨설", "고위"],
    "스포츠": ["스포츠", "운동선수", "코치"],
    "전기전자": ["전기", "전자", "통신", "기계"],
}

OCCUPATION_ALIAS_TO_CATEGORY: dict[str, str] = {
    "it": "it", "아이티": "it", "it종사자": "it", "it업계": "it", "개발자": "it",
    "프로그래머": "it", "소프트웨어": "it", "sw": "it", "전산": "it", "웹개발": "it",
    "백엔드": "it", "프론트엔드": "it", "개발": "it",
    "의료": "의료", "의료진": "의료", "의사": "의료", "간호사": "의료", "약사": "의료",
    "한의사": "의료", "치과의사": "의료", "수의사": "의료", "병원": "의료",
    "교육": "교육", "교사": "교육", "선생님": "교육", "강사": "교육", "교수": "교육", "교직": "교육",
    "금융": "금융", "금융권": "금융", "은행원": "금융", "보험설계사": "금융", "증권": "금융", "재무": "금융",
    "공무원": "공무원", "행정직": "공무원", "경찰": "공무원", "소방관": "공무원", "공직": "공무원",
    "생산": "생산", "생산직": "생산", "제조": "생산", "제조업": "생산", "공장": "생산",
    "노동자": "생산", "공장노동자": "생산", "기계조작": "생산",
    "농부": "농림어업", "농업": "농림어업", "어부": "농림어업", "어업": "농림어업",
    "임업": "농림어업", "축산": "농림어업", "농민": "농림어업", "농어민": "농림어업",
    "군인": "군인", "직업군인": "군인", "부사관": "군인", "장교": "군인", "현역군인": "군인",
    "예술": "예술", "예술가": "예술", "디자이너": "예술", "화가": "예술", "작가": "예술",
    "가수": "예술", "배우": "예술", "음악가": "예술", "미술가": "예술",
    "법률": "법률", "변호사": "법률", "법조인": "법률", "판사": "법률", "변리사": "법률",
    "연구": "연구", "연구원": "연구", "과학자": "연구", "엔지니어": "연구", "기술자": "연구",
    "영업": "영업", "영업직": "영업", "영업사원": "영업", "판매원": "영업", "마케터": "영업", "마케팅": "영업",
    "운전": "운전", "운전기사": "운전", "택시기사": "운전", "버스기사": "운전", "택배": "운전", "배송": "운전",
    "건설": "건설", "건축": "건설", "토목": "건설", "목수": "건설", "배관공": "건설",
    "요리": "요리", "요리사": "요리", "셰프": "요리", "조리사": "요리", "주방장": "요리", "제빵사": "요리",
    "미용": "미용", "미용사": "미용", "헤어디자이너": "미용", "네일": "미용", "메이크업": "미용",
    "경비": "경비", "경비원": "경비", "보안요원": "경비", "청소부": "경비", "미화원": "경비",
    "사무": "사무", "사무직": "사무", "회사원": "사무", "경리": "사무", "회계사": "사무", "비서": "사무",
    "복지": "복지", "사회복지사": "복지", "요양보호사": "복지", "간병인": "복지", "돌봄": "복지",
    "언론": "언론", "기자": "언론", "아나운서": "언론", "방송인": "언론", "pd": "언론", "편집자": "언론",
    "경영": "경영", "경영자": "경영", "ceo": "경영", "임원": "경영", "관리자": "경영", "컨설턴트": "경영",
    "스포츠": "스포츠", "운동선수": "스포츠", "코치": "스포츠", "체육인": "스포츠",
    "통신": "전기전자", "전기기사": "전기전자", "전자": "전기전자", "기계공학": "전기전자",
}


def expand_occupation_categories(occupations: list[str]) -> list[str]:
    """occupation 추출값(카테고리어/직업명 혼재)을 KSCO 부분매칭용 어근 배열로 확장.

    - 별칭(IT/생산직/농부/군인 등) → 해당 카테고리 어근 배열로 치환(0매칭 폴백 방지).
    - 이미 구체 직업어면 그대로 통과. 중복 제거, 순서 보존.
    """
    out: list[str] = []
    seen: set[str] = set()
    for raw in occupations or []:
        if not raw:
            continue
        key = str(raw).strip().lower().replace(" ", "")
        cat = OCCUPATION_ALIAS_TO_CATEGORY.get(key)
        roots = OCCUPATION_CATEGORY_KEYWORDS[cat] if cat else [str(raw).strip()]
        for r in roots:
            if r not in seen:
                seen.add(r)
                out.append(r)
    return out


# ============================================================
# 생애역할 다중필드 규칙 (대학생/취준생/은퇴자 등)
# ============================================================

LIFE_ROLE_RULES: dict[str, dict] = {
    # (A) occupation 어근으로 좁히는 역할 (데이터에 실재)
    "it직군": {"cues": ("it종사자", "it업계", "it직군", "아이티", "개발자", "프로그래머", "소프트웨어개발", "웹개발"),
               "occupations": ["개발자", "프로그래머", "소프트웨어", "웹", "네트워크", "데이터"], "employment": "employed"},
    "생산직": {"cues": ("생산직", "생산라인", "공장노동", "공장근로", "제조업노동", "현장근로자"),
              "occupations": ["생산", "제조", "조립", "조작원"], "employment": "employed"},
    "농어업인": {"cues": ("농부", "농민", "농업인", "농어민", "어부", "어업인", "축산농가", "농사꾼"),
               "occupations": ["농업", "어업", "임업", "축산"], "employment": "employed"},
    "군인": {"cues": ("현역군인", "직업군인", "부사관", "장교", "병사", "군복무"),
            "occupations": ["부사관", "장교", "병사"], "employment": "employed"},
    "운전기사": {"cues": ("운전기사", "운전사", "버스기사", "택시기사", "화물기사", "트럭운전"),
               "occupations": ["운전원"], "employment": "employed"},
    "배달라이더": {"cues": ("라이더", "택배", "배송기사", "배달원", "퀵서비스"),
                "occupations": ["택배"], "employment": "employed"},
    "돌봄종사자": {"cues": ("요양보호사", "간병인", "케어워커", "보육교사"),
                "occupations": ["요양", "간병", "돌봄", "보육"], "employment": "employed"},
    # (B) occupation 불가 → employment/age + remaining 보존 (없는 신호 안 지어냄)
    "프리랜서": {"cues": ("프리랜서", "프리랜스", "프리랜써"), "occupations": [], "employment": "employed"},
    "자영업자": {"cues": ("자영업", "개인사업", "소상공인", "사장님", "점주", "가게운영", "장사"),
               "occupations": [], "employment": "employed"},
    "예술가": {"cues": ("예술가", "아티스트", "창작자", "예술인"), "occupations": [], "employment": None},
    "대학생": {"cues": ("대학생", "대학교학생", "대학재학", "캠퍼스", "재학생"),
             "occupations": [], "age_min": 20, "age_max": 24, "employment": None},
    "취준생": {"cues": ("취준생", "취업준비", "구직자", "취업준비생", "구직중"),
             "occupations": [], "age_min": 20, "age_max": 29, "employment": "unemployed"},
    "사회초년생": {"cues": ("사회초년생", "신입사원", "사회초년", "첫직장", "주니어직장"),
                "occupations": [], "age_min": 23, "age_max": 29, "employment": "employed"},
    "은퇴자": {"cues": ("은퇴자", "은퇴", "퇴직자", "정년퇴직", "은퇴후", "노후"),
             "occupations": [], "age_min": 60, "age_max": 99, "employment": "unemployed"},
    "전업주부": {"cues": ("전업주부", "주부", "가정주부", "전업맘", "가사전담"),
              "occupations": [], "employment": "unemployed"},
}


def apply_life_role(ex: dict, query: str | None) -> dict:
    """생애역할 단서를 (age/employment/occupations)에 반영. LLM이 비웠을 때만 보강.

    occupations는 '추가'가 아니라 '비어있을 때만' 어근으로 채움(카테고리어 오염 방지).
    family_types는 절대 건드리지 않음(은퇴자 가구 노이즈 금지). 첫 매칭 역할만 적용.
    """
    q = (query or "").replace(" ", "")
    for rule in LIFE_ROLE_RULES.values():
        if not any(cue.replace(" ", "") in q for cue in rule["cues"]):
            continue
        if rule.get("occupations") and not ex.get("occupations"):
            ex["occupations"] = list(rule["occupations"])
        if rule.get("employment") is not None and ex.get("employment_status") is None:
            ex["employment_status"] = rule["employment"]
        if rule.get("age_min") is not None and ex.get("age_min") is None:
            ex["age_min"] = rule["age_min"]
        if rule.get("age_max") is not None and ex.get("age_max") is None:
            ex["age_max"] = rule["age_max"]
        break
    return ex


# ============================================================
# 학력/전공 동의어
# ============================================================

EDUCATION_SYNONYMS: dict[str, list[str]] = {
    "무학": ["무학", "정규교육없음"],
    "초등학교": ["초졸", "초등졸", "국졸"],
    "중학교": ["중졸", "중학졸"],
    "고등학교": ["고졸", "고등졸", "실업계", "인문계졸"],
    "2~3년제 전문대학": ["전문대", "전문대졸", "전문학사", "초대졸", "2년제", "3년제"],
    "4년제 대학교": ["대졸", "학사", "대학졸업", "4년제", "학부졸"],
    "대학원": ["대학원", "석사", "박사", "석박사", "대학원졸", "대학원생"],
}

BACHELORS_FIELD_SYNONYMS: dict[str, list[str]] = {
    "공학·제조·건설": ["공대", "이공계", "공학", "엔지니어링", "기계공학", "건축", "토목"],
    "정보통신기술": ["it전공", "컴공", "컴퓨터공학", "전산", "소프트웨어학", "정보보안전공"],
    "경영·행정·법": ["경영", "상경", "경상", "경제학", "행정", "법학", "로스쿨", "회계학", "무역학"],
    "예술·인문": ["문과", "인문", "어문", "철학", "사학", "예체능", "미대", "음대", "디자인전공"],
    "사회과학·언론": ["문과", "사회과학", "정치외교", "사회학", "신문방송", "언론", "심리학", "미디어"],
    "보건·복지": ["간호", "보건", "사회복지", "간호학", "물리치료", "임상병리", "재활"],
    "교육": ["사범", "교대", "교육학", "사범대", "초등교육", "유아교육전공"],
    "자연과학·수학": ["자연대", "이학", "자연과학", "수학과", "물리학", "화학과", "생물학", "통계학"],
    "농림어업·수의학": ["농대", "농학", "수의대", "수의학", "원예", "임학", "수산학", "축산학전공"],
    "서비스": ["관광학", "호텔경영", "조리학", "외식경영", "뷰티전공"],
}


def apply_education_synonyms(ex: dict, query: str | None) -> dict:
    """학력 동의어→education_levels, 전공 동의어→additional_filters['bachelors_field'].
    LLM이 비웠을 때만 보강. '문과'는 예술·인문+사회과학·언론 둘 다."""
    q = (query or "").replace(" ", "").lower()
    if not ex.get("education_levels"):
        levels = [real for real, syns in EDUCATION_SYNONYMS.items()
                  if any(s.replace(" ", "").lower() in q for s in syns)]
        if levels:
            ex["education_levels"] = levels
    add = dict(ex.get("additional_filters") or {})
    if not add.get("bachelors_field"):
        fields = [real for real, syns in BACHELORS_FIELD_SYNONYMS.items()
                  if any(s.replace(" ", "").lower() in q for s in syns)]
        if fields:
            add["bachelors_field"] = sorted(set(fields))
            ex["additional_filters"] = add
    return ex


# ============================================================
# 값 스내핑/검증 — isin 0매칭 구조적 차단
# ============================================================

def snap_to_valid(ex: dict, store, query: str) -> dict:
    """LLM/코드가 채운 카테고리 값을 데이터셋 실제값에 검증·치환.

    정확일치→통과 / SYNONYM_MAPS 동의어→치환 / 미일치→드롭(+remaining 강등).
    occupation은 실제 직업명 substring 존재 어근만 남기고 0매칭 어근은 강등.
    → filter_indices 진입 전에 isin 0을 구조적으로 차단(폴백이 메타 통째로 버리는 일 방지).
    """
    out = dict(ex)
    dropped: dict[str, list[str]] = {}
    demote: list[str] = []

    def _snap_list(field_key: str, col: str) -> None:
        vals = out.get(field_key) or []
        if not vals:
            return
        valid = VALID_VALUES.get(col, set())
        synmap = SYNONYM_MAPS.get(col, {})
        kept: list[str] = []
        for v in vals:
            v = str(v).strip()
            if v in valid:
                kept.append(v)
            elif synmap.get(v) in valid:
                kept.append(synmap[v])
            else:
                dropped.setdefault(field_key, []).append(v)
                demote.append(v)
        out[field_key] = list(dict.fromkeys(kept))

    _snap_list("education_levels", "education_level")
    _snap_list("marital_statuses", "marital_status")
    _snap_list("sex", "sex")

    # provinces: filter_indices가 _normalize_province_label로 정규화 → 정규화 후 검증.
    prov = out.get("provinces") or []
    if prov:
        from services.store import _normalize_province_label
        valid_prov = VALID_VALUES["province"]
        kept_prov = []
        for p in prov:
            if _normalize_province_label(str(p)) in valid_prov:
                kept_prov.append(p)
            else:
                dropped.setdefault("provinces", []).append(p)
                demote.append(str(p))
        out["provinces"] = kept_prov

    # additional_filters: housing_type / bachelors_field / military_status
    add = dict(out.get("additional_filters") or {})
    for col in ("housing_type", "bachelors_field", "military_status"):
        vals = add.get(col)
        if not vals:
            continue
        valid = VALID_VALUES.get(col, set())
        synmap = SYNONYM_MAPS.get(col, {})
        kept = []
        for v in vals:
            v = str(v).strip()
            if v in valid:
                kept.append(v)
            elif synmap.get(v) in valid:
                kept.append(synmap[v])
            else:
                dropped.setdefault(col, []).append(v)
                demote.append(v)
        if kept:
            add[col] = list(dict.fromkeys(kept))
        else:
            add.pop(col, None)
    out["additional_filters"] = add

    # occupation: 실제 직업명 substring 존재 어근만 남김(0매칭 어근 → 임베딩 강등)
    occs = out.get("occupations") or []
    if occs:
        kept_occ: list[str] = []
        for root in occs:
            root = str(root).strip()
            if not root:
                continue
            if store is not None and store.occupation_has_substring(root):
                kept_occ.append(root)
            else:
                dropped.setdefault("occupations", []).append(root)
                demote.append(root)
        out["occupations"] = list(dict.fromkeys(kept_occ))

    if demote:
        base = (out.get("remaining_query") or "").strip()
        merged = " ".join([base, *demote]).strip()
        out["remaining_query"] = " ".join(dict.fromkeys(merged.split()))

    out["snap_dropped"] = dropped
    return out


def snap_category_values(values: list[str] | None, col: str, store=None) -> list[str]:
    """카테고리 값 리스트를 데이터셋 실제값으로 스내핑(검증/치환/확장). 비매칭은 드롭.

    - occupation: expand_occupation_categories로 카테고리어→어근 확장 후, store가 있으면
      실제 직업명 substring 존재 어근만 남김(고용상태 추상어 '은퇴/무직' 등 자동 탈락).
    - 그 외: VALID_VALUES 정확일치 / SYNONYM_MAPS 동의어 치환 / family_type은 HOUSEHOLD_SYNONYMS
      다중값 폴백 / 미일치 드롭.
    구조화 필터(persona_filter 명시값)·SellingPoints.target_* 정규화에 공용으로 쓴다.
    """
    vals = values or []
    if not vals:
        return []
    if col == "occupation":
        roots = expand_occupation_categories(vals)
        if store is None:
            return roots
        return [r for r in roots if store.occupation_has_substring(r)]

    valid = VALID_VALUES.get(col, set())
    syn = SYNONYM_MAPS.get(col, {})
    out: list[str] = []
    for v in vals:
        v = str(v).strip()
        if v in valid:
            out.append(v)
        elif syn.get(v) in valid:
            out.append(syn[v])
        elif col == "family_type":
            out.extend(h for h in _apply_synonyms(v, HOUSEHOLD_SYNONYMS) if h in valid)
        # else: 미일치 드롭(isin 0매칭 → 차원 희석 방지)
    return list(dict.fromkeys(out))


def normalize_selling_points(sp, store=None):
    """SellingPoints.target_*(sex/family_types/education/occupations)를 데이터셋 실제값으로 정규화.

    분석/A·B/겹침의 extract_selling_points 직후 1회 적용 → scoring._rule_bonus의 하드 isin/
    substring 매칭에 raw 환각값('부부'·'1인 가구'·'IT'·'은퇴')이 직격해 차원이 0매칭으로
    희석되던 결함을 차단. persona 탐색과 동일한 매칭 보증을 분석계열에도 부여한다.
    age/keywords/category_weights는 불변(isin 대상 아님).
    """
    if store is None:
        from services.store import get_store
        store = get_store()
    return sp.model_copy(update={
        "target_sex": snap_category_values(sp.target_sex, "sex"),
        "target_education_levels": snap_category_values(sp.target_education_levels, "education_level"),
        "target_family_types": snap_category_values(sp.target_family_types, "family_type"),
        "target_occupations": snap_category_values(sp.target_occupations, "occupation", store),
    })


# ============================================================
# 통합 오케스트레이터
# ============================================================

def normalize_extracted(ex: dict, query: str | None, store=None) -> dict:
    """LLM 추출 결과에 코드 정규화를 6단계로 덧입혀 새 dict 반환.

    순서가 핵심:
      (1) 생애역할(occupations/employment/age, LLM 비었을때만)
      (2) 가구/혼인/지역 동의어 → 실제값(가구단서는 family_types 확정)
      (3) 학력/전공 동의어(LLM 비었을때만)
      (4) 직업 카테고리 → 어근 확장
      (5) 값 스내핑/검증(isin 0 차단, 미일치 임베딩 강등)
      (6) 레거시: has_children/1인가구 family_types(가구단서 없을때만) + 세대 age + 잔여정리
    store 인자는 occupation substring 검증용(기본 None=레이지 로드, 하위호환).
    """
    if store is None:
        from services.store import get_store
        store = get_store()

    out = dict(ex)

    # (1) 생애역할
    out = apply_life_role(out, query)

    # (2) 가구/혼인/지역
    household = _apply_synonyms(query, HOUSEHOLD_SYNONYMS)
    household_set_family = bool(household)
    if household:
        out["family_types"] = household
    if not out.get("marital_statuses"):
        marital = _apply_synonyms(query, MARITAL_SYNONYMS)
        if marital:
            out["marital_statuses"] = marital
    if not out.get("provinces"):
        region = _apply_synonyms(query, REGION_SYNONYMS)
        if region:
            out["provinces"] = region

    # (3) 학력/전공
    out = apply_education_synonyms(out, query)

    # (4) 직업 어근 확장
    if out.get("occupations"):
        out["occupations"] = expand_occupation_categories(out["occupations"])

    # (5) 값 스내핑/검증
    out = snap_to_valid(out, store, query or "")

    # (6) 레거시 코드 정규화
    if not household_set_family:
        ft = family_types_for_has_children(out.get("has_children"), query)
        if ft:  # 빈 결과면 기존 값 보존(가구 단서가 채운 것 안 지움)
            out["family_types"] = ft
    solo_applied = out.get("family_types") == SOLO_FAMILY_TYPES

    gen_applied = False
    if out.get("age_min") is None and out.get("age_max") is None:
        lo, hi = age_range_for_generation(query)
        if lo is not None or hi is not None:
            out["age_min"], out["age_max"] = lo, hi
            gen_applied = True

    remaining = out.get("remaining_query")
    if remaining is None:
        remaining = query or ""
    remaining = strip_absorbed_terms(
        remaining, drop_generation=gen_applied, drop_solo=solo_applied
    )
    # 동의어로 흡수된 가구/지역/혼인/학력 단서 + 일반 접미사 제거(임베딩 과컷 방지)
    out["remaining_query"] = _strip_phrasing(remaining, query)
    return out


# ============================================================
# 점진적 폴백 — 0명일 때 약→강 순으로 하나씩만 풀어 메타 보존
# ============================================================

# 완화 순서(약한 제약=먼저 풀기). occupation이 가장 0 유발 잦음, age/지역은 마지막. sex 제외.
RELAX_ORDER: list[str] = [
    "occupations", "education_levels", "additional_filters",
    "family_types", "marital_statuses", "provinces", "age",
]

_AXIS_LABEL = {
    "occupations": "직업", "education_levels": "학력", "additional_filters": "주거·전공·병역",
    "family_types": "가구형태", "marital_statuses": "혼인", "provinces": "지역", "age": "연령",
}


def progressive_fallback(merged: dict, explicit: dict, store, embed_text, query: str | None) -> dict:
    """메타 매칭 0명일 때 약한 제약부터 단계적으로 풀어 0을 벗어난다.

    Args:
      merged:   병합 메타 dict(LLM추출+명시). filter_indices 인자 키들.
      explicit: 사용자 사이드바 명시필터(절대 풀지 않는 바닥). search 경로는 {}.
      store, embed_text: 의존성 주입. query: 임베딩 보강용 원문.

    Returns: {indices, similarities, threshold, fallback_reason, relaxed_axes}.
      모두 풀어도 0이면 indices=[].
    """
    import numpy as np
    from services.store import FilterParams

    def _params(active: dict) -> FilterParams:
        return FilterParams(
            age_min=active.get("age_min"), age_max=active.get("age_max"),
            sex=active.get("sex") or None, provinces=active.get("provinces") or None,
            marital_statuses=active.get("marital_statuses") or None,
            family_types=active.get("family_types") or None,
            education_levels=active.get("education_levels") or None,
            occupations=active.get("occupations") or None,
            employment=active.get("employment"),
            additional_filters=active.get("additional_filters") or None,
        )

    def _rank(cand_idx, text_in, threshold, strict=False):
        if len(cand_idx) == 0 or not (text_in or "").strip():
            return {}, cand_idx
        vec = np.array(embed_text(text_in), dtype=np.float32)
        n = float(np.linalg.norm(vec))
        if n == 0:
            return {}, cand_idx
        q = (vec / n).astype(np.float32)
        sims = store.embeddings[cand_idx] @ q
        order = np.argsort(-sims)
        s_idx, s_sims = cand_idx[order], sims[order]
        keep = s_sims >= threshold
        if keep.any():
            s_idx, s_sims = s_idx[keep], s_sims[keep]
        elif strict:
            # 아무것도 임계 통과 못 함 + strict(base가 전체 모집단) → 빈 결과로 종료.
            # (release하면 전체 모집단이 그대로 반환돼 노이즈 입력이 80만 홍수로 샘)
            return {}, s_idx[:0]
        return {int(i): float(s) for i, s in zip(s_idx, s_sims, strict=False)}, s_idx

    active = dict(merged)
    relaxed: list[str] = []

    for axis in RELAX_ORDER:
        if axis == "age":
            if explicit.get("age_min") is None and explicit.get("age_max") is None:
                if active.get("age_min") is not None or active.get("age_max") is not None:
                    active["age_min"] = active["age_max"] = None
                    relaxed.append("연령")
        elif axis == "additional_filters":
            if active.get("additional_filters"):
                active["additional_filters"] = None
                relaxed.append("주거·전공·병역")
        else:
            cur = active.get(axis)
            exp = explicit.get(axis)
            if cur and cur != exp:
                active[axis] = exp
                relaxed.append(_AXIS_LABEL.get(axis, axis))

        if not relaxed:
            continue  # 이번 축은 풀 게 없었음(명시필터거나 비어있음)

        idx = store.filter_indices(_params(active))
        if len(idx) > 0:
            relaxed_terms = _collect_relaxed_terms(merged, active)
            embed_in = " ".join([(query or "").strip(), *relaxed_terms]).strip()
            sims_map, sorted_idx = _rank(idx, embed_in, 0.20)
            reason = f"메타 매칭 0명 → 약한 제약부터 완화({', '.join(relaxed)}) 후 시멘틱 보강"
            return {"indices": sorted_idx, "similarities": sims_map, "threshold": 0.20,
                    "fallback_reason": reason, "relaxed_axes": relaxed}

    # 명시필터(또는 메타 전체 완화) 베이스 + 원문 전체 임베딩(0.25).
    #  - 원문 전체를 임베딩: 잔여를 축약하면("등산과 캠핑을 즐기는"→"등산 캠핑") 유사도가 약화돼
    #    정상 자유어가 0건이 되는 회귀가 생긴다. 폴백에선 원문 전체로 임베딩해 의미를 살린다.
    #  - 0.25: 정상 자유어(수천~만)와 노이즈(@@@/무의미어 0~수십)를 가르는 실측 분리점.
    #  - strict(base가 전체 모집단=명시필터 없음)면 0건 통과 시 빈 결과 → 노이즈 80만 홍수 차단.
    #    명시필터 subset이면 release 허용(사용자 명시 의도 보존).
    has_explicit = any(
        explicit.get(k) for k in
        ("age_min", "age_max", "sex", "provinces", "family_types", "education_levels", "occupations")
    )
    base_idx = store.filter_indices(_params(explicit))
    if len(base_idx) > 0 and query:
        sims_map, sorted_idx = _rank(base_idx, query, 0.25, strict=not has_explicit)
        if len(sorted_idx) > 0:
            return {"indices": sorted_idx, "similarities": sims_map, "threshold": 0.25,
                    "fallback_reason": "자동 추출 메타 전체 완화 → 명시 조건만 유지하고 원문 시멘틱 검색",
                    "relaxed_axes": relaxed + ["전체"]}
    return {"indices": [], "similarities": {}, "threshold": None,
            "fallback_reason": None, "relaxed_axes": relaxed}


def _collect_relaxed_terms(original: dict, active: dict) -> list[str]:
    """완화로 제거된 메타 값들의 표시문자열(임베딩 보강용)."""
    terms: list[str] = []
    for key in ("occupations", "education_levels", "family_types", "marital_statuses", "provinces"):
        before = original.get(key) or []
        after = active.get(key) or []
        terms.extend([v for v in before if v not in after])
    add_b = original.get("additional_filters") or {}
    if add_b and not active.get("additional_filters"):
        for vals in add_b.values():
            terms.extend(vals)
    return list(dict.fromkeys(terms))
