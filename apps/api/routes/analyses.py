"""GET /api/analyses, GET /api/analyses/{id} — 분석 이력 조회."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from services.persistence import (
    count_simulations_by_analysis,
    delete_all_analyses,
    delete_analysis,
    get_analysis,
    list_analyses,
    list_simulations_by_analysis,
)

router = APIRouter(prefix="/api", tags=["analyses"])


class AnalysisSummary(BaseModel):
    id: str
    created_at: str
    summary: str
    key_benefits: list[str]
    max_score: float
    # 핵심 타겟(상위 0.5%) 평균 반응강도 — 상세 헤드라인(ScoreCard heroValue)과 동일 지표.
    core_reaction: float = 0.0
    top_persona_count: int
    top_province: str | None = None
    top_province_count: int = 0
    total_ms: int
    simulation_count: int = 0


class AnalysesListResponse(BaseModel):
    total: int
    items: list[AnalysisSummary]


@router.get("/analyses", response_model=AnalysesListResponse)
def list_endpoint(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> AnalysesListResponse:
    """분석 이력 요약 리스트 (최신순)."""
    items, total = list_analyses(limit=limit, offset=offset)
    sim_counts = count_simulations_by_analysis()
    for item in items:
        item["simulation_count"] = sim_counts.get(item["id"], 0)
    return AnalysesListResponse(total=total, items=items)


@router.get("/analyses/{analysis_id}")
def detail_endpoint(analysis_id: str) -> dict:
    """분석 이력 단건 전체 (4섹션 다시 렌더링용).

    응답은 AnalyzeResponse와 동일 구조 + 추가 메타(id, created_at, product_text 일부)
    + simulations(이 분석에 묶인 과거 시뮬레이션 전체, 최신순).
    """
    cached = get_analysis(analysis_id)
    if cached is None:
        raise HTTPException(status_code=404, detail=f"분석 이력 없음: {analysis_id}")
    # get_analysis는 파싱 캐시의 공유 객체를 반환하므로 in-place 변형 시 캐시가 오염된다.
    # 아래에서 top-level 키(analysis_id/simulations)만 추가하므로 얕은 복사로 격리한다.
    rec = {**cached}
    # 저장 레코드는 식별 키가 'id'뿐이라 AnalyzeResponse 계약의 'analysis_id'가 빠져 있다.
    # 프론트(SurveyCta 등)가 result.analysis_id로 /survey/{id} 링크를 만들므로 동일 값으로 채운다.
    rec.setdefault("analysis_id", rec.get("id"))
    rec["simulations"] = list_simulations_by_analysis(analysis_id)
    return rec


@router.delete("/analyses/{analysis_id}")
def delete_endpoint(analysis_id: str) -> dict:
    """분석 단건 + 연관 시뮬레이션 삭제."""
    deleted = delete_analysis(analysis_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"분석 이력 없음: {analysis_id}")
    return {"deleted": True, "id": analysis_id}


@router.delete("/analyses")
def delete_all_endpoint() -> dict:
    """모든 분석 + 시뮬레이션 일괄 삭제 (되돌릴 수 없음)."""
    counts = delete_all_analyses()
    return {"deleted": True, **counts}
