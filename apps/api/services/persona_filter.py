"""페르소나 메타 필터 + 자연어 검색 비즈니스 로직.

routes/dataset.py의 거대 핸들러(personas_filter)를 서비스 계층으로 분리한 것.
라우트는 요청/응답 모델과 filter_personas()만 호출한다. HTTP에 의존하지 않으며,
입력 오류는 ValueError로 신호하고 라우트가 HTTPException으로 변환한다.

흐름:
  0) 자연어 쿼리 → 메타 조건 자동 추출 (LLM)
  1) req 명시 메타 + 추출 메타 병합
  2) store.filter_indices → 후보 인덱스
  3) (옵션) 임베딩 정렬 + 임계값 컷
  4) 매칭 0명 시 2단계 키워드 폴백
  5) 페이지 슬라이스 + 인구통계 분포 집계
"""

from __future__ import annotations

import time
from typing import Literal

import numpy as np
from pydantic import BaseModel, Field

from services.dataset_stats import count_by, occupations_grouped
from services.query_normalization import (
    normalize_extracted,
    progressive_fallback,
    snap_category_values,
)
from services.store import FilterParams, get_store

# ============================================================
# 요청/응답 모델 (lib/api.ts와 1:1 대응)
# ============================================================

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
    # 금융 속성 필터 (AI Hub 통신카드CB 통합)
    insurance_interest: bool = False                          # 보험 관심자만
    life_stages: list[str] = Field(default_factory=list)     # 생애주기 (싱글/신혼/영유아자녀/청소년자녀/성인자녀/실버)
    income_top: bool = False                                  # 소득 상위자만
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
    # 현황(overview)과 동일 그룹핑/집계로 매칭 결과 전체를 분포 표시.
    # 하위 호환을 위해 default 부여 — 빈 결과 분기는 기본값([])으로 자동 직렬화된다.
    occupations_grouped: list[dict] = Field(default_factory=list)  # [{group, count, ratio, top_jobs}, ...]
    family_type: list[dict] = Field(default_factory=list)          # [{label, count}, ...]
    housing_type: list[dict] = Field(default_factory=list)         # [{label, count}, ...]


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
    # housing_type/bachelors_field/military_status/district
    additional_filters: dict[str, list[str]] = Field(default_factory=dict)
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
    # LLM 메타 추출이 너무 좁아 0명이 나왔을 때 자동으로 한 단계 더 시도한 결과.
    # - applied=True면 결과는 폴백 검색 결과 (사용자에게 안내 노출)
    # - reason은 어떤 단계의 폴백이 적용됐는지 (UI 안내용)
    fallback_applied: bool = False
    fallback_reason: str | None = None
    elapsed_ms: dict[str, int]


# 자연어 쿼리 시 자동 추출 메타가 비어 있는 경우 fallback으로 사용할 유사도 임계값.
# 추출이 잘 되면 메타가 이미 좁혀주므로 임계값 컷은 적용하지 않음.
QUERY_MATCH_THRESHOLD: float = 0.3


def filter_personas(req: PersonaFilterRequest) -> PersonaFilterResponse:
    """메타 필터 + (옵션) 자연어 검색 + 페이지네이션 + 분포 통계.

    흐름:
      1) store.filter_indices(meta) → 후보 인덱스
      2) req.query 있으면 → 임베딩 후 그 인덱스 대상 cosine 정렬, similarity 부여
                   없으면 → 인덱스 그대로 (정렬은 uuid asc로 안정)
      3) 페이지 슬라이스 + 인구통계 분포(sex/age_bins/province) 집계

    입력 오류(age_min > age_max)는 ValueError로 신호 — 라우트가 400으로 변환.
    """
    if req.age_min is not None and req.age_max is not None and req.age_min > req.age_max:
        raise ValueError("age_min이 age_max보다 큽니다")

    t_total = time.perf_counter()
    store = get_store()

    # 폴백/임베딩 단계에서 공통으로 갱신되는 상태. 진입 시 한 번만 초기화하고,
    # 폴백이 먼저 채우면 이후 임베딩 단계는 스킵된다.
    similarities: dict[int, float] = {}
    used_threshold: float | None = None
    fallback_applied: bool = False
    fallback_reason: str | None = None

    # 0) 자연어 쿼리 → 메타 조건 자동 추출 (LLM)
    #    실패해도 graceful: extracted_filter=None으로 두고 임베딩만 적용.
    extracted: ExtractedFilter | None = None
    embed_query_text: str | None = None
    t_extract = 0
    if req.query:
        from services.llm import extract_filter_from_query

        t0 = time.perf_counter()
        try:
            # 코드 정규화 일원화: family_types(has_children·1인가구→혼자 거주),
            # age(세대 슬랭 MZ/Z/밀레니얼 등 보강), remaining_query(흡수 단서 제거)를 한 번에 처리.
            ex = normalize_extracted(extract_filter_from_query(req.query), req.query, store)

            extracted = ExtractedFilter(
                sex=ex.get("sex", []),
                age_min=ex.get("age_min"),
                age_max=ex.get("age_max"),
                provinces=ex.get("provinces", []),
                marital_statuses=ex.get("marital_statuses", []),
                has_children=ex.get("has_children"),
                employment_status=ex.get("employment_status"),
                occupations=ex.get("occupations", []),
                education_levels=ex.get("education_levels", []),
                family_types=ex.get("family_types", []),
                additional_filters=ex.get("additional_filters") or {},
                # normalize가 흡수 단서를 제거한 잔여를 그대로 사용(빈 문자열이면 임베딩은 원문 fallback,
                # 단 잔여가 비면 임계 컷은 적용 안 됨 → 메타 결과를 유사도 정렬만).
                remaining_query=ex.get("remaining_query", ""),
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

    # 구조화 필터(사이드바 명시값)는 normalize_extracted를 안 거친다 → 여기서 직업 어근확장 +
    # 가구/학력 값 스내핑을 적용해 'IT'/'1인 가구' 같은 명시 입력의 isin/substring 0매칭(→AND 전멸)을
    # 막는다. query 경로 추출값은 이미 정규화돼 있어 재적용해도 idempotent(안전).
    merged_occupations = snap_category_values(merged_occupations, "occupation", store) or None
    merged_family = snap_category_values(merged_family, "family_type") or None
    merged_education = snap_category_values(merged_education, "education_level") or None

    # 점진적 폴백용 — 병합 메타(LLM+명시) + 사용자 명시필터(완화 시 절대 보존할 바닥).
    merged_meta = {
        "age_min": merged_age_min, "age_max": merged_age_max,
        "sex": merged_sex, "provinces": merged_provinces,
        "marital_statuses": merged_marital, "family_types": merged_family,
        "education_levels": merged_education, "occupations": merged_occupations,
        "employment": merged_employment, "additional_filters": merged_additional,
    }
    explicit_meta = {
        "age_min": req.age_min, "age_max": req.age_max,
        "sex": req.sex or None, "provinces": req.provinces or None,
        "family_types": req.family_types or None,
        "education_levels": req.education_levels or None,
        "occupations": req.occupations or None,
    }

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
        # 금융 필터는 사용자 명시 조건 — 자연어 추출 대상 아니므로 req에서 직접 전달
        insurance_interest=req.insurance_interest or None,
        life_stages=req.life_stages or None,
        income_top=req.income_top or None,
    ))
    t_filter = int((time.perf_counter() - t0) * 1000)

    meta_filter_total = int(len(candidate_idx))

    # 점진적 폴백 — 메타 매칭 0명일 때 약한 제약부터(occupation→학력→주거/전공→가구→혼인→지역→연령)
    # 하나씩만 풀어 0을 벗어나는 즉시 멈춘다. 사용자 명시필터(explicit_meta)는 모든 단계에서
    # 보존하므로, 기존처럼 '메타를 통째로 버려 연령·지역까지 잃는' 결함이 없다(메타 최대 보존).
    def _run_fallback():
        if not req.query:
            return None
        from services.llm import embed_text as _embed
        return progressive_fallback(merged_meta, explicit_meta, store, _embed, req.query)

    if meta_filter_total == 0:
        fb = _run_fallback()
        if fb and len(fb["indices"]) > 0:
            candidate_idx = fb["indices"]
            similarities = fb["similarities"]
            used_threshold = fb["threshold"]
            fallback_reason = fb["fallback_reason"]
            fallback_applied = True
            # meta_filter_total은 '메타로는 0이었음'을 보존하기 위해 0 유지.
            # 임베딩 분기 진입은 fallback_applied로 차단된다.
        else:
            return PersonaFilterResponse(
                total=0, meta_filter_total=0, match_threshold=None,
                extracted_filter=extracted,
                page=req.page, page_size=req.page_size,
                page_personas=[],
                distribution=PersonaFilterDistribution(sex={}, age_bins=[], province={}),
                has_query=bool(req.query),
                fallback_applied=False,
                fallback_reason=None,
                elapsed_ms={
                    "extract": t_extract,
                    "filter": t_filter,
                    "search": 0,
                    "total": int((time.perf_counter() - t_total) * 1000),
                },
            )

    # 3) 자연어 쿼리 시 임베딩 정렬 (정렬 후 임계값 컷은 자동 추출 메타가 비었을 때만 fallback)
    t_search = 0
    if not fallback_applied and req.query and embed_query_text:
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
                keep_mask = sorted_sims >= QUERY_MATCH_THRESHOLD
                if keep_mask.any() or not has_extracted_meta:
                    # 자유어 검색(메타 없음)은 컷 필수(0도 진짜 무매칭). 메타가 있는데
                    # 컷이 전부 지우면 컷을 해제해 메타 결과를 유사도 정렬만 유지한다 —
                    # '주부'처럼 잔여어 임베딩 유사도가 낮아 0이 돼도 메타(무직 등)는 살린다.
                    used_threshold = QUERY_MATCH_THRESHOLD
                    candidate_idx = candidate_idx[keep_mask]
                    sorted_sims = sorted_sims[keep_mask]

            similarities = {int(i): float(s) for i, s in zip(candidate_idx, sorted_sims, strict=False)}
        t_search = int((time.perf_counter() - t0) * 1000)

    # 최종 매칭 수
    total = int(len(candidate_idx))
    if total == 0:
        # 메타는 0보다 컸으나 임베딩 컷에서 0이 된 경우 → 폴백 한 번 더 시도.
        # (이미 fallback_applied=True인 경우는 1단계 폴백 결과가 0건이 되는 코너 케이스인데,
        #  이때는 재호출하면 동일 결과만 반환하므로 빈 응답으로 종료한다.)
        if not fallback_applied:
            fb = _run_fallback()
            if fb and len(fb["indices"]) > 0:
                candidate_idx = fb["indices"]
                similarities = fb["similarities"]
                used_threshold = fb["threshold"]
                fallback_reason = fb["fallback_reason"]
                fallback_applied = True
                total = int(len(candidate_idx))

        if total == 0:
            return PersonaFilterResponse(
                total=0, meta_filter_total=meta_filter_total, match_threshold=used_threshold,
                extracted_filter=extracted,
                page=req.page, page_size=req.page_size,
                page_personas=[],
                distribution=PersonaFilterDistribution(sex={}, age_bins=[], province={}),
                has_query=bool(req.query),
                fallback_applied=fallback_applied,
                fallback_reason=fallback_reason,
                elapsed_ms={
                    "extract": t_extract,
                    "filter": t_filter,
                    "search": t_search,
                    "total": int((time.perf_counter() - t_total) * 1000),
                },
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
    age_bins = [{"label": lbl, "count": int(c)} for lbl, c in zip(bin_labels, bin_counts, strict=False) if c > 0]

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
            # 현황과 동일한 직업군 그룹핑 + 가구 형태 Top 15(+기타) + 주거 형태 집계. full_rows = 매칭 결과 전체.
            occupations_grouped=occupations_grouped(full_rows),
            family_type=count_by(full_rows, "family_type", top_n=15, include_others=True),
            housing_type=count_by(full_rows, "housing_type"),
        ),
        has_query=bool(req.query),
        fallback_applied=fallback_applied,
        fallback_reason=fallback_reason,
        elapsed_ms={
            "extract": t_extract,
            "filter": t_filter,
            "search": t_search,
            "total": int((time.perf_counter() - t_total) * 1000),
        },
    )
