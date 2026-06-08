"""겹침 분석 결과 영속화 — data/cannibals.jsonl. abtest_persistence 패턴 동일.

JSONL append-only (services.fileio 공통 헬퍼). 이력 목록·상세·삭제 지원.
"""

from __future__ import annotations

import os
from pathlib import Path

from services.fileio import append_jsonl, read_jsonl, rewrite_jsonl

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
DEFAULT_CANNIBALS_LOG = _PROJECT_ROOT / "data" / "cannibals.jsonl"


def _log_path() -> Path:
    return Path(os.environ.get("CANNIBALS_LOG", str(DEFAULT_CANNIBALS_LOG)))


def persist_cannibal(payload: dict) -> str:
    """겹침 분석 1건 영속화 + cannibal_id 반환."""
    return append_jsonl(_log_path(), payload)


def _read_all() -> list[dict]:
    return read_jsonl(_log_path())


def list_cannibals(limit: int = 20, offset: int = 0) -> tuple[list[dict], int]:
    """겹침 분석 이력 요약 리스트 (최신순) + 전체 건수.

    요약 행 스키마: id, created_at, input_mode, cohort_level, item_count, labels, total_ms, llm_provider
    """
    records = _read_all()
    records.sort(key=lambda r: r.get("created_at", ""), reverse=True)

    total = len(records)
    page = records[offset : offset + limit]

    summaries: list[dict] = []
    for r in page:
        items = r.get("items", []) or []
        summaries.append({
            "id": r.get("id"),
            "created_at": r.get("created_at"),
            "input_mode": r.get("input_mode", "concept"),
            "cohort_level": r.get("cohort_level", "target"),
            "item_count": len(items),
            "labels": [it.get("label", "") for it in items],
            "total_ms": (r.get("elapsed_ms") or {}).get("total", 0),
            "llm_provider": r.get("llm_provider", "sllm"),
        })

    return summaries, total


def get_cannibal(cannibal_id: str) -> dict | None:
    """단건 전체 데이터. 없으면 None."""
    for r in _read_all():
        if r.get("id") == cannibal_id:
            return r
    return None


def delete_cannibal(cannibal_id: str) -> bool:
    """단건 삭제. 1건 이상 지워지면 True."""
    records = _read_all()
    remaining = [r for r in records if r.get("id") != cannibal_id]
    if len(remaining) == len(records):
        return False
    rewrite_jsonl(_log_path(), remaining)
    return True


def delete_all_cannibals() -> int:
    """전체 삭제. 삭제된 건수 반환."""
    records = _read_all()
    path = _log_path()
    if path.exists():
        rewrite_jsonl(path, [])
    return len(records)
