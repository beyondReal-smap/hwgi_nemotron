"""자연어 검색 쿼리 정규화 헬퍼.

LLM이 추출한 메타 결과를 검색 가능한 필터로 한 번 더 정리한다.
케이스별 분기를 각 서비스에 흩뿌리지 않고, 공통 규칙은 여기서만 관리한다.
"""

from __future__ import annotations

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

_SOLO_CUES = ("혼자", "1인", "1인가구", "싱글", "독신")
_COHABITATION_CUES = ("동거", "함께사는", "같이사는", "가족과", "부모와", "배우자와", "자녀와")


def family_types_for_has_children(has_children: bool | None, query: str | None = None) -> list[str]:
    """has_children 단서를 데이터셋 family_type 목록으로 바꾼다.

    query의 동거/혼자 단서를 함께 보면 solo family_type을 되살리지 않는다.
    """
    q = (query or "").replace(" ", "")
    solo_hint = any(cue in q for cue in _SOLO_CUES)
    cohabitation_hint = any(cue in q for cue in _COHABITATION_CUES)

    if has_children is True:
        return list(CHILD_FAMILY_TYPES)
    if has_children is False:
        family_types = list(NO_CHILD_FAMILY_TYPES)
        if cohabitation_hint and not solo_hint:
            family_types = [ft for ft in family_types if not ft.startswith("혼자 거주")]
        return family_types
    if cohabitation_hint and not solo_hint:
        return list(NON_SOLO_FAMILY_TYPES)
    return []
