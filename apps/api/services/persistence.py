"""분석 이력 영속화 — Phase 5 전에는 로컬 JSON Lines, 이후 Supabase 교체.

JSONL은 append-only이므로 read 시 전체 파일 스캔.
이력 수천 건까지는 무난, 그 이상은 SQLite/Supabase 전환 권장.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
DEFAULT_LOG_PATH = _PROJECT_ROOT / "data" / "analyses.jsonl"
DEFAULT_SIMULATIONS_LOG = _PROJECT_ROOT / "data" / "simulations.jsonl"


def _log_path() -> Path:
    return Path(os.environ.get("ANALYSES_LOG", str(DEFAULT_LOG_PATH)))


def _simulations_log_path() -> Path:
    return Path(os.environ.get("SIMULATIONS_LOG", str(DEFAULT_SIMULATIONS_LOG)))


def persist_analysis(payload: dict) -> str:
    """분석 1건 영속화 + analysis_id 반환."""
    path = _log_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    analysis_id = str(uuid.uuid4())
    record = {
        "id": analysis_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        **payload,
    }
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    return analysis_id


def _read_all() -> list[dict]:
    """이력 전체를 읽어 list로 반환. 깨진 줄은 무시."""
    path = _log_path()
    if not path.exists():
        return []

    records: list[dict] = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                # 손상된 줄은 건너뛰기 (운영 안정성)
                continue
    return records


def list_analyses(limit: int = 20, offset: int = 0) -> tuple[list[dict], int]:
    """이력 요약 리스트 (최신순) + 전체 건수.

    응답 행 스키마 (전체 데이터의 일부만 발췌):
      id, created_at, summary, max_score, top_persona_count,
      top_province, top_province_count, total_ms, key_benefits[3]
    """
    records = _read_all()
    records.sort(key=lambda r: r.get("created_at", ""), reverse=True)

    total = len(records)
    page = records[offset : offset + limit]

    summaries: list[dict] = []
    for r in page:
        sp = r.get("selling_points", {}) or {}
        top_personas = r.get("top_personas", []) or []
        province_stats = r.get("province_stats", []) or []
        top_province = province_stats[0] if province_stats else {}

        max_score = max((p.get("score", 0) for p in top_personas), default=0.0)

        summaries.append({
            "id": r.get("id"),
            "created_at": r.get("created_at"),
            "summary": sp.get("summary", ""),
            "key_benefits": sp.get("key_benefits", [])[:3],
            "max_score": round(max_score, 1),
            "top_persona_count": len(top_personas),
            "top_province": top_province.get("name"),
            "top_province_count": top_province.get("count", 0),
            "total_ms": (r.get("elapsed_ms") or {}).get("total", 0),
        })

    return summaries, total


def get_analysis(analysis_id: str) -> dict | None:
    """단건 전체 데이터. 없으면 None."""
    records = _read_all()
    for r in records:
        if r.get("id") == analysis_id:
            return r
    return None


# ============================================================
# 삭제 (analysis 단건 / 전체 — 연관 simulations 함께 정리)
# ============================================================

def _rewrite_jsonl(path: Path, records: list[dict]) -> None:
    """파일 전체를 records로 재작성 (atomic write)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    tmp.replace(path)


def delete_analysis(analysis_id: str) -> bool:
    """단건 삭제 + 연관 시뮬레이션 함께 정리. 1건 이상 지워지면 True."""
    analyses = _read_all()
    remaining = [r for r in analyses if r.get("id") != analysis_id]
    if len(remaining) == len(analyses):
        return False  # 일치하는 id 없음

    _rewrite_jsonl(_log_path(), remaining)

    # 연관 simulations 정리
    sims = _read_all_simulations()
    sim_remaining = [s for s in sims if s.get("analysis_id") != analysis_id]
    if len(sim_remaining) != len(sims):
        _rewrite_jsonl(_simulations_log_path(), sim_remaining)

    return True


def delete_all_analyses() -> dict[str, int]:
    """모든 분석 + 시뮬레이션 삭제. 삭제된 건수 반환."""
    analyses = _read_all()
    sims = _read_all_simulations()

    analyses_path = _log_path()
    sims_path = _simulations_log_path()

    # 파일이 없으면 그대로 skip, 있으면 빈 파일로 truncate
    if analyses_path.exists():
        _rewrite_jsonl(analyses_path, [])
    if sims_path.exists():
        _rewrite_jsonl(sims_path, [])

    return {"analyses": len(analyses), "simulations": len(sims)}


# ============================================================
# 시뮬레이션 영속화 (별도 JSONL, analysis_id로 1:N 조인)
# ============================================================

def _read_all_simulations() -> list[dict]:
    """시뮬레이션 이력 전체 (깨진 줄 무시)."""
    path = _simulations_log_path()
    if not path.exists():
        return []

    records: list[dict] = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return records


def append_simulation(payload: dict) -> str:
    """시뮬레이션 1건 영속화 + simulation_id 반환.

    payload는 analysis_id, question, responses, elapsed_ms 등을 포함해야 한다.
    """
    path = _simulations_log_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    simulation_id = str(uuid.uuid4())
    record = {
        "id": simulation_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        **payload,
    }
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    return simulation_id


def list_simulations_by_analysis(analysis_id: str) -> list[dict]:
    """특정 분석에 묶인 시뮬레이션 전체 (최신순)."""
    records = [r for r in _read_all_simulations() if r.get("analysis_id") == analysis_id]
    records.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    return records


def count_simulations_by_analysis() -> dict[str, int]:
    """analysis_id별 시뮬레이션 건수 매핑 (이력 목록 카운트용)."""
    counts: dict[str, int] = {}
    for r in _read_all_simulations():
        aid = r.get("analysis_id")
        if aid:
            counts[aid] = counts.get(aid, 0) + 1
    return counts
