"""자연어 → 페르소나 하이브리드 검색 (메타 추출 + 임베딩 정렬).

순수 코사인 유사도만 쓰면 "30대 워킹맘" 같은 짧은 인구통계 쿼리는
긴 페르소나 텍스트와 의미축이 분산돼 점수가 낮게 나와 매칭 0이 자주 발생.
→ /personas 탐색 페이지의 personas_filter 흐름을 동일하게 적용해
   1) LLM이 자연어에서 인구통계 메타(성별/연령/지역/직업/has_children/employment) 추출
   2) 메타 조건으로 후보군 축소 — '검색에 부합하는 사람'의 진짜 수
   3) 잔여 의미 텍스트가 의미 있게 남으면 그 잔여만 임베딩으로 가중·컷
   4) 메타 추출이 빈 경우(자유어 검색)에만 임베딩 임계값으로 자체 컷

응답 키 메모:
- total_candidates: 전체 데이터 행 수 (1M)
- meta_filter_total: LLM 메타 + 명시 메타로 좁힌 후보 수
- match_total: 최종 매칭 수 (메타 + 선택적 임베딩 컷 후)
- match_threshold: 임베딩 컷이 적용된 경우 임계값, 아니면 None
- extracted_filter: UI 칩에 노출할 LLM 추출 결과 (None이면 추출 실패/생략)
- results: 상위 limit건 (similarity 내림차순)
"""

from __future__ import annotations

import time

import numpy as np

from services.llm import embed_text, extract_filter_from_query
from services.store import FilterParams, get_store

# 메타 추출이 비어 있을 때만 적용하는 fallback 임계값.
# 메타가 좁혀주면 분류 컷이 이미 작동하므로 임베딩 컷을 추가하지 않음.
QUERY_MATCH_THRESHOLD: float = 0.3

# has_children=true/false → family_type 매핑 (routes/dataset.py와 동일 정의).
# 추출된 has_children 단서를 메타 필터에 반영하기 위해 여기서도 직접 매핑.
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


def _empty_extracted(query: str) -> dict:
    """LLM 추출 실패 시 채울 기본 dict."""
    return {
        "sex": [],
        "age_min": None,
        "age_max": None,
        "provinces": [],
        "marital_statuses": [],
        "has_children": None,
        "employment_status": None,
        "occupations": [],
        "education_levels": [],
        "additional_filters": {},
        "remaining_query": query,
    }


def _count_meta_axes(ex: dict) -> int:
    """추출된 메타 축의 개수 (0이면 자유어 검색)."""
    return sum([
        bool(ex.get("sex")),
        ex.get("age_min") is not None or ex.get("age_max") is not None,
        bool(ex.get("provinces")),
        bool(ex.get("marital_statuses")),
        ex.get("has_children") is not None,
        ex.get("employment_status") is not None,
        bool(ex.get("occupations")),
        bool(ex.get("education_levels")),
        bool(ex.get("additional_filters")),
    ])


def search_personas(query: str, limit: int = 20) -> dict:
    """자연어 쿼리 → 하이브리드(메타+임베딩) 검색 결과.

    Returns:
        {
          "query": str,
          "total_candidates": int,             # 전체 데이터 행 수
          "meta_filter_total": int,            # 메타 필터 통과 수 ('부합하는 사람')
          "match_total": int,                  # 최종 매칭 (메타+선택적 임베딩 컷)
          "match_threshold": float | None,     # 임베딩 컷 임계값 (적용 시)
          "extracted_filter": dict | None,     # LLM이 추출한 메타 (UI 칩용)
          "score_range": {"max": float|None, "min": float|None},  # 상위 K건의 유사도 범위
          "elapsed_ms": {"extract": int, "embed": int, "filter": int, "search": int, "total": int},
          "results": [{uuid, similarity, persona, ...}, ...]
        }
    """
    query = query.strip()
    if not query:
        raise ValueError("query가 비어 있습니다")
    if len(query) > 500:
        query = query[:500]

    t_total = time.perf_counter()
    store = get_store()
    total_candidates = store.total

    # 1) 자연어 → 메타 조건 추출 (실패 시 빈 추출 = 자유어로 처리)
    t0 = time.perf_counter()
    try:
        ex = extract_filter_from_query(query)
    except Exception:
        ex = _empty_extracted(query)
    t_extract = int((time.perf_counter() - t0) * 1000)

    # has_children → family_types 매핑
    auto_family_types: list[str] = []
    has_children = ex.get("has_children")
    if has_children is True:
        auto_family_types = list(CHILD_FAMILY_TYPES)
    elif has_children is False:
        auto_family_types = list(NO_CHILD_FAMILY_TYPES)

    # 2) 메타 필터 적용
    t0 = time.perf_counter()
    candidate_idx = store.filter_indices(FilterParams(
        age_min=ex.get("age_min"),
        age_max=ex.get("age_max"),
        sex=ex.get("sex") or None,
        provinces=ex.get("provinces") or None,
        marital_statuses=ex.get("marital_statuses") or None,
        family_types=auto_family_types or None,
        education_levels=ex.get("education_levels") or None,
        occupations=ex.get("occupations") or None,
        employment=ex.get("employment_status"),
        additional_filters=ex.get("additional_filters") or None,
    ))
    t_filter = int((time.perf_counter() - t0) * 1000)
    meta_filter_total = int(len(candidate_idx))

    # UI 칩용으로 family_types도 포함해 응답 (메타 추출 결과를 그대로 패스스루)
    extracted_filter = {
        **ex,
        "family_types": auto_family_types,
    }

    # 메타 필터로 0명이면 fallback: 자유어 임베딩 검색으로 전환 (사용자가 결과 0을 못 보게)
    # → 메타 추출이 너무 공격적이었을 가능성을 흡수.
    # 단, 메타가 0이면 자유어 검색 자체도 의미 없으므로 그냥 빈 응답을 돌려도 OK.
    if meta_filter_total == 0:
        return {
            "query": query,
            "total_candidates": total_candidates,
            "meta_filter_total": 0,
            "match_total": 0,
            "match_threshold": None,
            "extracted_filter": extracted_filter,
            "score_range": {"max": None, "min": None},
            "elapsed_ms": {
                "extract": t_extract,
                "embed": 0,
                "filter": t_filter,
                "search": 0,
                "total": int((time.perf_counter() - t_total) * 1000),
            },
            "results": [],
        }

    # 3) 임베딩 정렬 + (필요 시) 임계값 컷
    # 임베딩에 넣을 텍스트 결정:
    # - 잔여 텍스트가 2자 이상이면 그것만 (메타로 흡수된 단어는 의미 중복이 됨)
    # - 너무 짧거나 비면 원문 사용
    remaining = (ex.get("remaining_query") or "").strip()
    embed_text_input = remaining if len(remaining) >= 2 else query

    meta_axes = _count_meta_axes(ex)
    residual_len = len(remaining)
    has_semantic_residual = residual_len >= 2

    # 컷 적용 조건:
    # - 자유어 검색 (메타 0축) → 임베딩 컷 필수 (안 그러면 100만 행 그냥 정렬)
    # - 메타가 있고 의미 있는 잔여가 남음 → 잔여로 추가 컷
    # - 메타만 있고 잔여 빔(완전 흡수) → 컷 없이 메타 결과를 유사도로 정렬만
    # 잘못된 잔여(예: "워킹맘"이 메타로 흡수됐는데 잔여로 잘못 남는 경우)에 대한
    # 안전망은 "컷 적용 후 0건이면 컷 해제" fallback으로 처리 (휴리스틱 제거).
    apply_cut = has_semantic_residual or meta_axes == 0

    t0_embed = time.perf_counter()
    vec = np.array(embed_text(embed_text_input), dtype=np.float32)
    t_embed = int((time.perf_counter() - t0_embed) * 1000)

    t0 = time.perf_counter()
    q_norm = float(np.linalg.norm(vec))
    if q_norm == 0:
        # 임베딩 0벡터 방어 — 메타 결과만 반환 (정렬은 인덱스 순서)
        sorted_idx = candidate_idx
        sims = np.zeros(len(sorted_idx), dtype=np.float32)
        used_threshold: float | None = None
    else:
        q = (vec / q_norm).astype(np.float32)
        cand_emb = store.embeddings[candidate_idx]  # (N, 1536)
        sims_cand = cand_emb @ q  # (N,)
        order = np.argsort(-sims_cand)
        sorted_idx = candidate_idx[order]
        sorted_sims = sims_cand[order]

        if apply_cut:
            keep_mask = sorted_sims >= QUERY_MATCH_THRESHOLD
            kept = int(keep_mask.sum())
            if kept > 0:
                sorted_idx = sorted_idx[keep_mask]
                sims = sorted_sims[keep_mask]
                used_threshold = QUERY_MATCH_THRESHOLD
            elif meta_axes > 0:
                # 컷이 너무 공격적 (LLM이 메타 흡수 단어를 잔여로 잘못 남긴 경우 등) →
                # 메타 결과를 살리고 컷 해제. 사용자에게 0명을 보여주는 것보다 낫다.
                sims = sorted_sims
                used_threshold = None
            else:
                # 자유어 검색이고 컷도 0건 → 결과 진짜 없음
                sorted_idx = sorted_idx[keep_mask]
                sims = sorted_sims[keep_mask]
                used_threshold = QUERY_MATCH_THRESHOLD
        else:
            sims = sorted_sims
            used_threshold = None
    t_search = int((time.perf_counter() - t0) * 1000)

    match_total = int(len(sorted_idx))

    # 4) 상위 limit건
    k = min(limit, match_total)
    top_idx = sorted_idx[:k]
    top_sims = sims[:k]

    rows = store.get_rows(top_idx)
    results = []
    for (_, r), sim in zip(rows.iterrows(), top_sims):
        results.append({
            "uuid": str(r["uuid"]),
            "similarity": round(float(sim), 4),
            "persona": str(r["persona"]),
            "sex": str(r["sex"]),
            "age": int(r["age"]),
            "province": str(r["province"]),
            "district": str(r["district"]),
            "occupation": str(r["occupation"]),
            "marital_status": str(r["marital_status"]) if r.get("marital_status") else None,
            "family_type": str(r["family_type"]) if r.get("family_type") else None,
        })

    return {
        "query": query,
        "total_candidates": total_candidates,
        "meta_filter_total": meta_filter_total,
        "match_total": match_total,
        "match_threshold": used_threshold,
        "extracted_filter": extracted_filter,
        "score_range": {
            "max": round(float(top_sims[0]), 4) if k > 0 else None,
            "min": round(float(top_sims[-1]), 4) if k > 0 else None,
        },
        "elapsed_ms": {
            "extract": t_extract,
            "embed": t_embed,
            "filter": t_filter,
            "search": t_search,
            "total": int((time.perf_counter() - t_total) * 1000),
        },
        "results": results,
    }
