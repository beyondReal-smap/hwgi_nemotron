"""분석 이력 영속화 — 로컬 JSON Lines.

JSONL은 append-only이므로 read 시 전체 파일 스캔.
이력 수천 건까지는 무난, 그 이상은 SQLite 전환 권장.
저수준 파일 I/O(append/read/rewrite)는 services.fileio 공통 헬퍼 사용.
"""

from __future__ import annotations

import os
import threading
from pathlib import Path

from services.fileio import append_jsonl, read_jsonl, rewrite_jsonl

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
DEFAULT_LOG_PATH = _PROJECT_ROOT / "data" / "analyses.jsonl"
DEFAULT_SIMULATIONS_LOG = _PROJECT_ROOT / "data" / "simulations.jsonl"


def _log_path() -> Path:
    return Path(os.environ.get("ANALYSES_LOG", str(DEFAULT_LOG_PATH)))


def _simulations_log_path() -> Path:
    return Path(os.environ.get("SIMULATIONS_LOG", str(DEFAULT_SIMULATIONS_LOG)))


def persist_analysis(payload: dict) -> str:
    """분석 1건 영속화 + analysis_id 반환."""
    return append_jsonl(_log_path(), payload)


# ============================================================
# 파싱 캐시 (BP-7/CQ-8)
# ============================================================
# get_analysis/list_analyses/delete가 매 호출마다 JSONL 전체를 재파싱하던 비용을 제거.
# 파일 stat(mtime_ns+size)을 키로 파싱 결과(records)와 id→record 인덱스를 캐시한다.
# 모든 쓰기(append/rewrite)는 fileio를 거쳐 mtime/size를 바꾸므로 추가/삭제가 자동 반영된다.
# 외부에서 파일을 직접 교체해도 stat이 달라지면 다음 호출에서 재파싱된다.
_cache_lock = threading.Lock()
# key: 절대경로 str → (stat_key, records, id_index)
_parse_cache: dict[str, tuple[tuple[int, int], list[dict], dict[str, dict]]] = {}


def _stat_key(path: Path) -> tuple[int, int] | None:
    """파일 stat 기반 캐시 키 (mtime_ns, size). 파일 없으면 None."""
    try:
        st = path.stat()
    except FileNotFoundError:
        return None
    return (st.st_mtime_ns, st.st_size)


def _load_cached(path: Path) -> tuple[list[dict], dict[str, dict]]:
    """파싱 결과(records)와 id→record 인덱스를 반환. stat이 바뀌면 재파싱.

    반환되는 리스트/딕트는 캐시 공유 객체이므로 호출자가 변형하면 안 된다(읽기 전용).
    """
    key = str(path.resolve())
    stat_key = _stat_key(path)
    if stat_key is None:
        return [], {}
    with _cache_lock:
        cached = _parse_cache.get(key)
        if cached is not None and cached[0] == stat_key:
            return cached[1], cached[2]
    # 파싱은 락 밖에서 (I/O가 길 수 있음). 동시 미스 시 마지막 쓰기가 캐시를 덮지만
    # 동일 stat이면 동일 결과라 무해.
    records = read_jsonl(path)
    index = {r["id"]: r for r in records if r.get("id")}
    with _cache_lock:
        _parse_cache[key] = (stat_key, records, index)
    return records, index


def _read_all() -> list[dict]:
    """이력 전체를 읽어 list로 반환. 깨진 줄은 무시.

    파싱 캐시를 사용한다. 반환 리스트는 캐시 공유 객체이므로 호출자가 in-place 변형 금지.
    """
    records, _ = _load_cached(_log_path())
    return records


def list_analyses(limit: int = 20, offset: int = 0) -> tuple[list[dict], int]:
    """이력 요약 리스트 (최신순) + 전체 건수.

    응답 행 스키마 (전체 데이터의 일부만 발췌):
      id, created_at, summary, max_score, top_persona_count,
      top_province, top_province_count, total_ms, key_benefits[3]
    """
    records = _read_all()
    # _read_all()은 캐시 공유 리스트를 반환하므로 in-place sort 금지 → sorted()로 새 리스트.
    records = sorted(records, key=lambda r: r.get("created_at", ""), reverse=True)

    total = len(records)
    page = records[offset : offset + limit]

    summaries: list[dict] = []
    for r in page:
        sp = r.get("selling_points", {}) or {}
        top_personas = r.get("top_personas", []) or []
        province_stats = r.get("province_stats", []) or []
        top_province = province_stats[0] if province_stats else {}

        max_score = max((p.get("score", 0) for p in top_personas), default=0.0)

        # 상세 헤드라인(ScoreCard heroValue)과 동일 지표: 핵심 타겟(core) 평균 반응강도.
        # core 있으면 avg_score, core가 비면 진입 컷(min_score), cohorts 자체가 없는
        # 옛 이력은 max_score로 폴백 → ScoreCard와 정합.
        cohorts = (r.get("population_stats", {}) or {}).get("cohorts", []) or []
        core = next((c for c in cohorts if c.get("name") == "core"), None)
        if core and core.get("size", 0) > 0:
            core_reaction = core.get("avg_score", 0.0)
        elif core is not None:
            core_reaction = core.get("min_score", 0.0)
        else:
            core_reaction = max_score

        summaries.append({
            "id": r.get("id"),
            "created_at": r.get("created_at"),
            "summary": sp.get("summary", ""),
            "key_benefits": sp.get("key_benefits", [])[:3],
            "max_score": round(max_score, 1),
            "core_reaction": round(core_reaction, 1),
            "top_persona_count": len(top_personas),
            "top_province": top_province.get("name"),
            "top_province_count": top_province.get("count", 0),
            "total_ms": (r.get("elapsed_ms") or {}).get("total", 0),
        })

    return summaries, total


def get_analysis(analysis_id: str) -> dict | None:
    """단건 전체 데이터. 없으면 None.

    id→record 인덱스로 O(1) 조회 (이전엔 매 호출 전체 선형 스캔).
    """
    _, index = _load_cached(_log_path())
    return index.get(analysis_id)


# ============================================================
# 삭제 (analysis 단건 / 전체 — 연관 simulations 함께 정리)
# ============================================================

def delete_analysis(analysis_id: str) -> bool:
    """단건 삭제 + 연관 시뮬레이션 함께 정리. 1건 이상 지워지면 True."""
    analyses = _read_all()
    remaining = [r for r in analyses if r.get("id") != analysis_id]
    if len(remaining) == len(analyses):
        return False  # 일치하는 id 없음

    rewrite_jsonl(_log_path(), remaining)

    # 연관 simulations 정리
    sims = _read_all_simulations()
    sim_remaining = [s for s in sims if s.get("analysis_id") != analysis_id]
    if len(sim_remaining) != len(sims):
        rewrite_jsonl(_simulations_log_path(), sim_remaining)

    return True


def delete_all_analyses() -> dict[str, int]:
    """모든 분석 + 시뮬레이션 삭제. 삭제된 건수 반환."""
    analyses = _read_all()
    sims = _read_all_simulations()

    analyses_path = _log_path()
    sims_path = _simulations_log_path()

    # 파일이 없으면 그대로 skip, 있으면 빈 파일로 truncate
    if analyses_path.exists():
        rewrite_jsonl(analyses_path, [])
    if sims_path.exists():
        rewrite_jsonl(sims_path, [])

    return {"analyses": len(analyses), "simulations": len(sims)}


# ============================================================
# 시뮬레이션 영속화 (별도 JSONL, analysis_id로 1:N 조인)
# ============================================================

def _read_all_simulations() -> list[dict]:
    """시뮬레이션 이력 전체 (깨진 줄 무시)."""
    return read_jsonl(_simulations_log_path())


def append_simulation(payload: dict) -> str:
    """시뮬레이션 1건 영속화 + simulation_id 반환.

    payload는 analysis_id, question, responses, elapsed_ms 등을 포함해야 한다.
    """
    return append_jsonl(_simulations_log_path(), payload)


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
