"""부모 동거 가구 형태 정밀 매핑 회귀 테스트.

버그(2026-06-08): '40대 부모와 동거' 탐색 시 family_types_for_has_children이
cohabitation 단서('동거'/'부모와')만 보고 NON_SOLO 37종을 반환 → isin 필터가
'배우자·자녀·부모와 거주' 등 다세대 복합형까지 통과시켜 과매칭.
기대: 단일 부모 동거 3종(부모/어머니/아버지와 동거)만 매칭.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.query_normalization import (
    family_types_for_has_children,
    normalize_extracted,
)

PARENT3 = {"부모와 동거", "어머니와 동거", "아버지와 동거"}


class _StubStore:
    """normalize_extracted의 occupation 스내핑용 최소 stub (6GB store 로드 회피)."""

    def occupation_has_substring(self, root: str) -> bool:
        return False


# ---- family_types_for_has_children: 부모 동거는 정확히 3종 ----

def test_parent_cohabitation_maps_to_three_types() -> None:
    for q in (
        "40대 부모와 동거",
        "부모와 동거",
        "부모님과 함께 사는 30대",
        "부모님 모시고 사는 사람",
        "어머니와 동거",
        "아버지와 동거하는 청년",
        "엄마랑 같이 사는",
        "본가살이 직장인",
    ):
        assert set(family_types_for_has_children(None, q)) == PARENT3, q


def test_parent_cohabitation_overrides_has_children() -> None:
    # '부모와 동거'는 자녀 동거 여부와 무관한 구체 구조 → has_children보다 우선.
    assert set(family_types_for_has_children(False, "부모와 동거")) == PARENT3
    assert set(family_types_for_has_children(True, "부모와 동거")) == PARENT3


# ---- 조부모/시부모/다세대 복합형은 부모 동거로 오매핑되지 않음 ----

def test_grandparent_and_inlaw_not_mapped_to_parents() -> None:
    for q in (
        "조부모와 동거",
        "외조부모와 동거하는",
        "시어머니와 동거",
        "시아버지와 동거",
        "배우자 자녀 부모와 거주",  # 다세대 복합형(거주)
        "부모와 거주하는 대가족",
    ):
        assert set(family_types_for_has_children(None, q)) != PARENT3, q


# ---- 일반 동거/1인 쿼리는 기존 동작 유지(회귀 방지) ----

def test_generic_cohabitation_unchanged() -> None:
    assert len(family_types_for_has_children(None, "가족과 함께 사는 사람")) == 37
    assert set(family_types_for_has_children(None, "혼자 사는 1인가구")) == {
        "혼자 거주",
        "혼자 거주 (배우자 별거)",
    }


# ---- normalize_extracted 통합: LLM 추출이 무엇이든 3종으로 수렴 ----

def test_normalize_extracted_converges_to_three_types() -> None:
    stub = _StubStore()
    query = "40대 부모와 동거"
    scenarios = [
        {"age_min": 40, "age_max": 49, "family_types": ["부모와 동거"]},  # 정밀 1종
        {"age_min": 40, "age_max": 49},  # 빈 추출
        {"age_min": 40, "age_max": 49, "family_types": ["부모와 동거", "배우자·자녀·부모와 거주"]},  # 과추출
        {"age_min": 40, "age_max": 49, "has_children": False},
    ]
    for ex in scenarios:
        out = normalize_extracted(dict(ex), query, stub)
        assert set(out.get("family_types") or []) == PARENT3, ex
        # 연령 등 다른 메타는 보존
        assert out.get("age_min") == 40 and out.get("age_max") == 49
