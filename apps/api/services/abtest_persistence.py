"""A/B 테스트 결과 영속화 — data/abtests.jsonl (analyses.jsonl과 분리).

MVP에선 영속화만 — UI 이력 목록·상세 조회는 v2에서.
analyses와 동일한 JSONL append-only 패턴.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
DEFAULT_ABTESTS_LOG = _PROJECT_ROOT / "data" / "abtests.jsonl"


def _log_path() -> Path:
    return Path(os.environ.get("ABTESTS_LOG", str(DEFAULT_ABTESTS_LOG)))


def persist_abtest(payload: dict) -> str:
    """A/B 테스트 1건 영속화 + abtest_id 반환."""
    path = _log_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    abtest_id = str(uuid.uuid4())
    record = {
        "id": abtest_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        **payload,
    }
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    return abtest_id


# ============================================================
# 조회 / 삭제 — analyses 패턴 동일
# ============================================================

def _read_all() -> list[dict]:
    """이력 전체 (깨진 줄 무시)."""
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
                continue
    return records


def list_abtests(limit: int = 20, offset: int = 0) -> tuple[list[dict], int]:
    """A/B 테스트 이력 요약 리스트 (최신순) + 전체 건수.

    요약 행 스키마:
      id, created_at, input_mode, baseline_variant, challenger_kind,
      label_a, label_b, baseline_label, challenger_label,
      recommended_variant, recommended_label, total_ms
    """
    records = _read_all()
    records.sort(key=lambda r: r.get("created_at", ""), reverse=True)

    total = len(records)
    page = records[offset : offset + limit]

    summaries: list[dict] = []
    for r in page:
        va = r.get("variant_a", {}) or {}
        vb = r.get("variant_b", {}) or {}
        label_a = va.get("label") or va.get("selling_points", {}).get("summary", "")[:40] or "안 A"
        label_b = vb.get("label") or vb.get("selling_points", {}).get("summary", "")[:40] or "안 B"

        baseline = r.get("baseline_variant", "A")
        baseline_label = label_a if baseline == "A" else label_b
        challenger_label = label_b if baseline == "A" else label_a

        recommended = r.get("recommended_variant", "split")
        recommended_label = (
            label_a if recommended == "A"
            else label_b if recommended == "B"
            else "타겟별 분기"
        )

        summaries.append({
            "id": r.get("id"),
            "created_at": r.get("created_at"),
            "input_mode": r.get("input_mode", "terms"),
            "baseline_variant": baseline,
            # 옛 레코드 호환: 누락 시 internal 기본값
            "challenger_kind": r.get("challenger_kind") or "internal",
            "label_a": label_a,
            "label_b": label_b,
            "baseline_label": baseline_label,
            "challenger_label": challenger_label,
            "recommended_variant": recommended,
            "recommended_label": recommended_label,
            "total_ms": (r.get("elapsed_ms") or {}).get("total", 0),
            "llm_provider": r.get("llm_provider", "sllm"),
        })

    return summaries, total


def get_abtest(abtest_id: str) -> dict | None:
    """단건 전체 데이터. 없으면 None.

    옛 레코드(challenger_kind 누락)는 internal 기본값으로 채워 반환 — 응답 스키마 검증 통과 보장.
    """
    for r in _read_all():
        if r.get("id") == abtest_id:
            if "challenger_kind" not in r:
                r["challenger_kind"] = "internal"
            if "baseline_variant" not in r:
                r["baseline_variant"] = "A"
            return r
    return None


def _rewrite_jsonl(path: Path, records: list[dict]) -> None:
    """파일 전체를 records로 재작성 (atomic)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    tmp.replace(path)


def delete_abtest(abtest_id: str) -> bool:
    """단건 삭제. 1건 이상 지워지면 True."""
    records = _read_all()
    remaining = [r for r in records if r.get("id") != abtest_id]
    if len(remaining) == len(records):
        return False
    _rewrite_jsonl(_log_path(), remaining)
    return True


def delete_all_abtests() -> int:
    """전체 삭제. 삭제된 건수 반환."""
    records = _read_all()
    path = _log_path()
    if path.exists():
        _rewrite_jsonl(path, [])
    return len(records)
