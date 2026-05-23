"""데이터셋 현황·페르소나 탐색 API."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from services.dataset_stats import (
    PERSONA_TEXT_COLS,
    get_dataset_overview,
    get_persona_samples,
)
from services.persona_search import search_personas
from services.store import FilterParams, get_store

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


class PersonaFilterRequest(BaseModel):
    """페르소나 메타 필터 + 옵션 자연어 검색.

    빈 필드는 해당 조건 무시. query가 있으면 후보 인덱스 대상 cosine 정렬.
    """

    age_min: int | None = Field(None, ge=0, le=120)
    age_max: int | None = Field(None, ge=0, le=120)
    sex: list[Literal["남자", "여자"]] = Field(default_factory=list)
    provinces: list[str] = Field(default_factory=list)
    family_types: list[str] = Field(default_factory=list)
    education_levels: list[str] = Field(default_factory=list)
    occupations: list[str] = Field(default_factory=list)
    query: str | None = Field(None, max_length=500)
    page: int = Field(1, ge=1)
    page_size: int = Field(24, ge=1, le=10000)


class PersonaCard(BaseModel):
    uuid: str
    sex: str
    age: int
    province: str
    district: str
    occupation: str
    family_type: str | None
    marital_status: str | None
    education_level: str | None
    persona: str
    similarity: float | None = None  # query가 있을 때만


class PersonaFilterDistribution(BaseModel):
    sex: dict[str, int]
    age_bins: list[dict]  # [{label: "0-9", count: N}, ...]
    province: dict[str, int]


class ExtractedFilter(BaseModel):
    """자연어 쿼리에서 LLM이 추출한 메타 조건. 사용자에게 투명하게 노출."""

    sex: list[str] = Field(default_factory=list)
    age_min: int | None = None
    age_max: int | None = None
    provinces: list[str] = Field(default_factory=list)
    marital_statuses: list[str] = Field(default_factory=list)
    has_children: bool | None = None
    employment_status: str | None = None  # "employed" | "unemployed" | None
    occupations: list[str] = Field(default_factory=list)
    education_levels: list[str] = Field(default_factory=list)
    family_types: list[str] = Field(default_factory=list)  # has_children 적용 후 자동 매핑된 family_type
    additional_filters: dict[str, list[str]] = Field(default_factory=dict)  # housing_type/bachelors_field/military_status/district
    remaining_query: str = ""


class PersonaFilterResponse(BaseModel):
    total: int                                      # 최종 매칭 수
    meta_filter_total: int                          # 메타 필터만 적용한 후의 수 (자동 추출 + 명시 메타 통합)
    match_threshold: float | None                   # 임계값 fallback이 적용된 경우만 (자동 추출 메타가 비었을 때)
    extracted_filter: ExtractedFilter | None        # 자연어에서 자동 추출된 메타 (UI 칩 노출용)
    page: int
    page_size: int
    page_personas: list[PersonaCard]
    distribution: PersonaFilterDistribution
    has_query: bool
    elapsed_ms: dict[str, int]


# 자연어 쿼리 시 자동 추출 메타가 비어 있는 경우 fallback으로 사용할 유사도 임계값.
# 추출이 잘 되면 메타가 이미 좁혀주므로 임계값 컷은 적용하지 않음.
QUERY_MATCH_THRESHOLD: float = 0.3


# has_children=true일 때 자동 적용할 자녀 포함 family_type 목록.
# 데이터셋의 39개 family_type 중 "자녀" 또는 "손자녀"가 라벨에 포함된 11종.
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

# has_children=false일 때 적용할 자녀 비포함 family_type 목록 (나머지 28개).
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


@router.post("/personas/filter", response_model=PersonaFilterResponse)
def personas_filter(req: PersonaFilterRequest) -> PersonaFilterResponse:
    """메타 필터 + (옵션) 자연어 검색 + 페이지네이션 + 분포 통계.

    흐름:
      1) store.filter_indices(meta) → 후보 인덱스
      2) req.query 있으면 → 임베딩 후 그 인덱스 대상 cosine 정렬, similarity 부여
                   없으면 → 인덱스 그대로 (정렬은 uuid asc로 안정)
      3) 페이지 슬라이스 + 인구통계 분포(sex/age_bins/province) 집계
    """
    import time

    if req.age_min is not None and req.age_max is not None and req.age_min > req.age_max:
        raise HTTPException(400, "age_min이 age_max보다 큽니다")

    t_total = time.perf_counter()
    store = get_store()

    # 0) 자연어 쿼리 → 메타 조건 자동 추출 (LLM)
    #    실패해도 graceful: extracted_filter=None으로 두고 임베딩만 적용.
    extracted: ExtractedFilter | None = None
    embed_query_text: str | None = None
    t_extract = 0
    if req.query:
        from services.llm import extract_filter_from_query

        t0 = time.perf_counter()
        try:
            ex = extract_filter_from_query(req.query)
            # has_children → family_types 자동 매핑
            auto_family_types: list[str] = []
            has_children = ex.get("has_children")
            if has_children is True:
                auto_family_types = list(CHILD_FAMILY_TYPES)
            elif has_children is False:
                auto_family_types = list(NO_CHILD_FAMILY_TYPES)

            extracted = ExtractedFilter(
                sex=ex.get("sex", []),
                age_min=ex.get("age_min"),
                age_max=ex.get("age_max"),
                provinces=ex.get("provinces", []),
                marital_statuses=ex.get("marital_statuses", []),
                has_children=has_children,
                employment_status=ex.get("employment_status"),
                occupations=ex.get("occupations", []),
                education_levels=ex.get("education_levels", []),
                family_types=auto_family_types,
                additional_filters=ex.get("additional_filters") or {},
                remaining_query=ex.get("remaining_query", req.query),
            )
            # 잔여 텍스트가 너무 짧으면 원문으로 임베딩 (의미 손실 방지)
            embed_query_text = (
                extracted.remaining_query
                if extracted.remaining_query and len(extracted.remaining_query) >= 2
                else req.query
            )
        except Exception:
            # 추출 실패 → 메타 추출 없이 원문으로 임베딩
            extracted = None
            embed_query_text = req.query
        t_extract = int((time.perf_counter() - t0) * 1000)

    # 1) 메타 병합 — req의 명시값 우선, 추출값은 보조
    def _merge_list(req_v: list, ex_v: list | None) -> list | None:
        # req에 명시값이 있으면 그것을, 없으면 추출값을 사용
        if req_v:
            return req_v
        return ex_v or None

    merged_age_min = req.age_min if req.age_min is not None else (extracted.age_min if extracted else None)
    merged_age_max = req.age_max if req.age_max is not None else (extracted.age_max if extracted else None)
    merged_sex = _merge_list(req.sex, extracted.sex if extracted else None)
    merged_provinces = _merge_list(req.provinces, extracted.provinces if extracted else None)
    merged_marital = _merge_list([], extracted.marital_statuses if extracted else None)
    merged_family = _merge_list(req.family_types, extracted.family_types if extracted else None)
    merged_education = _merge_list(req.education_levels, extracted.education_levels if extracted else None)
    merged_occupations = _merge_list(req.occupations, extracted.occupations if extracted else None)

    merged_employment = extracted.employment_status if extracted else None
    merged_additional = extracted.additional_filters if extracted else None

    # 2) 메타 필터 적용
    t0 = time.perf_counter()
    candidate_idx = store.filter_indices(FilterParams(
        age_min=merged_age_min,
        age_max=merged_age_max,
        sex=merged_sex,
        provinces=merged_provinces,
        marital_statuses=merged_marital,
        family_types=merged_family,
        education_levels=merged_education,
        occupations=merged_occupations,
        employment=merged_employment,
        additional_filters=merged_additional or None,
    ))
    t_filter = int((time.perf_counter() - t0) * 1000)

    meta_filter_total = int(len(candidate_idx))
    if meta_filter_total == 0:
        return PersonaFilterResponse(
            total=0, meta_filter_total=0, match_threshold=None,
            extracted_filter=extracted,
            page=req.page, page_size=req.page_size,
            page_personas=[],
            distribution=PersonaFilterDistribution(sex={}, age_bins=[], province={}),
            has_query=bool(req.query),
            elapsed_ms={"extract": t_extract, "filter": t_filter, "search": 0, "total": int((time.perf_counter() - t_total) * 1000)},
        )

    # 3) 자연어 쿼리 시 임베딩 정렬 (정렬 후 임계값 컷은 자동 추출 메타가 비었을 때만 fallback)
    similarities: dict[int, float] = {}
    t_search = 0
    used_threshold: float | None = None
    if req.query and embed_query_text:
        from services.llm import embed_text

        t0 = time.perf_counter()
        vec = np.array(embed_text(embed_query_text), dtype=np.float32)
        q_norm = float(np.linalg.norm(vec))
        if q_norm > 0:
            q = (vec / q_norm).astype(np.float32)
            cand_emb = store.embeddings[candidate_idx]
            sims = cand_emb @ q  # (N,)
            order = np.argsort(-sims)
            candidate_idx = candidate_idx[order]
            sorted_sims = sims[order]

            # 자동 추출 메타가 하나라도 있으면 그 자체로 분류 컷이 일부 적용됨.
            has_extracted_meta = extracted is not None and (
                bool(extracted.sex)
                or extracted.age_min is not None
                or extracted.age_max is not None
                or bool(extracted.provinces)
                or bool(extracted.marital_statuses)
                or bool(extracted.family_types)
                or bool(extracted.occupations)
                or bool(extracted.education_levels)
                or extracted.employment_status is not None
                or bool(extracted.additional_filters)
            )
            # 메타에 흡수되지 못한 자연어 잔여(remaining_query)가 의미 있으면 임베딩 컷도 적용.
            # 예) "여행 남자" → sex=남자(메타) + remaining_query="여행"(임베딩). 메타로만 좁히면
            #     "여행" 의도가 무시돼 남자 전체가 매칭되는 버그가 발생.
            #
            # 단, 메타가 충분(≥2축)히 추출됐고 remaining이 짧으면(≤5자) LLM이 메타 흡수 단어를
            # 잔여로 잘못 남긴 경우일 가능성이 높음 (예: "30대 워킹맘" → meta 4축 + remaining="워킹맘"
            # 3자 → 워킹맘은 sex+has_children+employment으로 이미 흡수됨). 이 경우 임베딩 컷을
            # 또 적용하면 메타와 이중 필터링되어 0명 매칭이 발생하므로 컷 스킵.
            meta_axes_count = sum([
                bool(extracted.sex) if extracted else False,
                (extracted.age_min is not None or extracted.age_max is not None) if extracted else False,
                bool(extracted.provinces) if extracted else False,
                bool(extracted.marital_statuses) if extracted else False,
                bool(extracted.family_types) if extracted else False,
                bool(extracted.occupations) if extracted else False,
                bool(extracted.education_levels) if extracted else False,
                (extracted.employment_status is not None) if extracted else False,
                bool(extracted.additional_filters) if extracted else False,
            ])
            residual_len = (
                len(extracted.remaining_query.strip()) if extracted and extracted.remaining_query else 0
            )
            short_residual_with_rich_meta = residual_len > 0 and residual_len <= 5 and meta_axes_count >= 2

            has_semantic_residual = (
                extracted is not None
                and residual_len >= 2
                and not short_residual_with_rich_meta
            )
            if has_semantic_residual or not has_extracted_meta:
                used_threshold = QUERY_MATCH_THRESHOLD
                keep_mask = sorted_sims >= QUERY_MATCH_THRESHOLD
                candidate_idx = candidate_idx[keep_mask]
                sorted_sims = sorted_sims[keep_mask]

            similarities = {int(i): float(s) for i, s in zip(candidate_idx, sorted_sims)}
        t_search = int((time.perf_counter() - t0) * 1000)

    # 최종 매칭 수
    total = int(len(candidate_idx))
    if total == 0:
        return PersonaFilterResponse(
            total=0, meta_filter_total=meta_filter_total, match_threshold=used_threshold,
            extracted_filter=extracted,
            page=req.page, page_size=req.page_size,
            page_personas=[],
            distribution=PersonaFilterDistribution(sex={}, age_bins=[], province={}),
            has_query=bool(req.query),
            elapsed_ms={"extract": t_extract, "filter": t_filter, "search": t_search, "total": int((time.perf_counter() - t_total) * 1000)},
        )

    # 3) 페이지 슬라이스
    start = (req.page - 1) * req.page_size
    end = start + req.page_size
    page_idx = candidate_idx[start:end]
    page_rows = store.df.iloc[page_idx]

    cards = []
    for _, r in page_rows.iterrows():
        uuid_str = str(r["uuid"])
        cards.append(PersonaCard(
            uuid=uuid_str,
            sex=str(r["sex"]),
            age=int(r["age"]),
            province=str(r["province"]),
            district=str(r["district"]),
            occupation=str(r["occupation"]) if r.get("occupation") else "",
            family_type=str(r["family_type"]) if r.get("family_type") else None,
            marital_status=str(r["marital_status"]) if r.get("marital_status") else None,
            education_level=str(r["education_level"]) if r.get("education_level") else None,
            persona=str(r["persona"]),
            similarity=round(similarities[int(r.name)], 4) if int(r.name) in similarities else None,
        ))

    # 4) 분포 집계 (전체 candidate_idx 기준 — 페이지 슬라이스 전)
    full_rows = store.df.iloc[candidate_idx]
    sex_counts = full_rows["sex"].value_counts().to_dict()
    province_counts = full_rows["province"].value_counts().to_dict()

    age_bin_edges = list(range(0, 101, 10))
    bin_labels = [f"{age_bin_edges[i]}-{age_bin_edges[i+1]-1}" for i in range(len(age_bin_edges) - 1)]
    bin_indices = np.clip(full_rows["age"].to_numpy() // 10, 0, len(bin_labels) - 1).astype(int)
    bin_counts = np.bincount(bin_indices, minlength=len(bin_labels))
    age_bins = [{"label": lbl, "count": int(c)} for lbl, c in zip(bin_labels, bin_counts) if c > 0]

    return PersonaFilterResponse(
        total=total,
        meta_filter_total=meta_filter_total,
        match_threshold=used_threshold,
        extracted_filter=extracted,
        page=req.page,
        page_size=req.page_size,
        page_personas=cards,
        distribution=PersonaFilterDistribution(
            sex={k: int(v) for k, v in sex_counts.items()},
            age_bins=age_bins,
            province={k: int(v) for k, v in province_counts.items()},
        ),
        has_query=bool(req.query),
        elapsed_ms={
            "extract": t_extract,
            "filter": t_filter,
            "search": t_search,
            "total": int((time.perf_counter() - t_total) * 1000),
        },
    )


@router.get("/personas/{persona_uuid}")
def get_persona_detail(persona_uuid: str) -> dict:
    """단일 페르소나 상세 — PersonaDetailModal용 풀 프로필."""
    store = get_store()
    rows = store.df[store.df["uuid"] == persona_uuid]
    if rows.empty:
        raise HTTPException(404, "persona not found")
    r = rows.iloc[0]
    # JSON 직렬화 가능한 dict로
    out = {}
    for col, val in r.items():
        if val is None or (isinstance(val, float) and np.isnan(val)):
            out[col] = None
        else:
            out[col] = val.item() if hasattr(val, "item") else val
    return out
