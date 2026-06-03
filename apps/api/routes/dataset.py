"""데이터셋 현황·페르소나 탐색 API.

비즈니스 로직은 services 계층에 위임한다:
- 데이터셋 통계:   services.dataset_stats
- 자연어 시멘틱 검색: services.persona_search
- 메타 필터 + 분포:  services.persona_filter (거대 핸들러 분리)
라우트는 요청 검증·HTTP 변환만 담당한다.
"""

from __future__ import annotations

from functools import lru_cache

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from services.dataset_stats import (
    PERSONA_TEXT_COLS,
    get_dataset_overview,
    get_persona_samples,
)
from services.persona_filter import (
    PersonaFilterRequest,
    PersonaFilterResponse,
    filter_personas,
)
from services.persona_search import search_personas
from services.store import get_store

router = APIRouter(prefix="/api/dataset", tags=["dataset"])


@router.get("/overview")
def overview() -> dict:
    """데이터셋 전체 통계 — 메타 + 인구통계 분포 + 지역 + 직업 Top + 페르소나 길이.

    PersonaStore의 df를 활용하므로 임베딩과 무관하게 즉시 응답.
    내부적으로 lru_cache로 1회만 계산 (~수십 ms 이내).
    """
    return get_dataset_overview()


@router.get("/personas/samples")
def persona_samples(
    column: str = Query(
        "persona",
        description=f"페르소나 카테고리 컬럼. 허용: {', '.join(PERSONA_TEXT_COLS)}",
    ),
    limit: int = Query(8, ge=2, le=20),
) -> dict:
    """특정 페르소나 카테고리에서 대표 샘플 N건 (길이 양극단).

    /overview 페이지의 "페르소나 텍스트 길이" 표에서 카테고리 클릭 시 사용.
    """
    try:
        samples = get_persona_samples(column=column, limit=limit)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"column": column, "limit": limit, "samples": samples}


class PersonaSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500, description="자연어 검색 쿼리")
    limit: int = Field(20, ge=1, le=100, description="반환할 페르소나 수")


@router.post("/personas/search")
def persona_search(req: PersonaSearchRequest) -> dict:
    """자연어 시멘틱 검색 (메타 추출 + 임베딩 정렬 하이브리드).

    내부적으로 /personas/filter와 동일한 메타 추출 → 후보 축소 → 잔여 의미 임베딩 정렬
    파이프라인을 사용. 응답에는 추출된 메타(extracted_filter)와 단계별 매칭 수
    (meta_filter_total / match_total)가 포함된다.

    예: "은퇴 후 등산 좋아하는 60대 남성" → sex=남자, age 60+, employment=unemployed,
        remaining='등산' → 메타 후보 N명, 임베딩 ≥0.3 컷으로 M명 매칭.
    예: "30대 워킹맘 수도권" → sex=여자, age 30-39, has_children=true, employment=employed,
        provinces=[서울/경기/인천], remaining='' → 메타 후보가 곧 매칭 결과.
    """
    try:
        return search_personas(req.query, req.limit)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"검색 실패: {e}") from e


# ============================================================
# 페르소나 탐색용 필터 + 패싯
# ============================================================


@router.get("/personas/facets")
def personas_facets() -> dict:
    """필터 UI에 채울 distinct 값 목록 (province / family_type / education_level 등).

    1회 계산 후 lru_cache (df 불변 가정). 응답 크기 작음.
    """
    return _compute_facets()


@lru_cache(maxsize=1)
def _compute_facets() -> dict:
    df = get_store().df
    return {
        "provinces": sorted(df["province"].dropna().unique().tolist()),
        "sex": ["남자", "여자"],
        "family_types": sorted(df["family_type"].dropna().unique().tolist()),
        "education_levels": [
            "무학", "초등학교", "중학교", "고등학교",
            "2~3년제 전문대학", "4년제 대학교", "대학원",
        ],
        # 직업은 너무 많아 단순 distinct 대신 KSCO 대분류만 노출 (옵션 — 일단 자유텍스트)
        "marital_statuses": sorted(df["marital_status"].dropna().unique().tolist())
        if "marital_status" in df.columns else [],
        "age_range": {
            "min": int(df["age"].min()),
            "max": int(df["age"].max()),
        },
    }


@router.post("/personas/filter", response_model=PersonaFilterResponse)
def personas_filter(req: PersonaFilterRequest) -> PersonaFilterResponse:
    """메타 필터 + (옵션) 자연어 검색 + 페이지네이션 + 분포 통계.

    비즈니스 로직은 services.persona_filter.filter_personas. 라우트는 HTTP 변환만 담당.
    """
    try:
        return filter_personas(req)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.get("/personas/{persona_uuid}")
def get_persona_detail(persona_uuid: str) -> dict:
    """단일 페르소나 상세 — PersonaDetailModal용 풀 프로필."""
    store = get_store()
    r = store.get_row_by_uuid(persona_uuid)
    if r is None:
        raise HTTPException(404, "persona not found")
    # JSON 직렬화 가능한 dict로
    out = {}
    for col, val in r.items():
        if val is None or (isinstance(val, float) and np.isnan(val)):
            out[col] = None
        else:
            out[col] = val.item() if hasattr(val, "item") else val
    return out
