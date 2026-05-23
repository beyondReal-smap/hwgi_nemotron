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
    rec = get_analysis(analysis_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"분석 이력 없음: {analysis_id}")
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
