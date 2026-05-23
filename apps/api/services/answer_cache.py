"""LLM 응답 캐시 — (persona × question × model × temperature) 단위.

목적:
  - 동일 조건 재실행 시 LLM 호출 0회 (비용·지연 절감)
  - 설문 일부 실패 후 재실행 시 성공한 응답 보존

디스크 레이아웃:
  data/answer_cache/
    └── {sha256[:2]}/{sha256}.json    # 샤딩으로 디렉토리당 파일 수 제한

캐시 키:
  sha256(persona_uuid + "|" + question_id + "|" + model + "|" + round(temp,2))

  - temperature는 소수 2자리 반올림으로 미세 차이 무시 (0.70 ≡ 0.701)
  - reasoning/scale 같은 옵션은 키에 포함하지 않음 (수정 시 별도 무효화 필요)
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import threading
from pathlib import Path

from models.survey import Answer

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
BASE_DIR = _PROJECT_ROOT / "data" / "answer_cache"

# 파일 시스템 동시 쓰기 보호 (캐시 키별 lock은 과한 메모리, 단일 락으로 충분)
_lock = threading.Lock()


def cache_key(
    persona_uuid: str,
    question_id: str,
    model: str,
    temperature: float,
) -> str:
    """동일 (persona+question+model+temp) 조합은 동일 키."""
    raw = f"{persona_uuid}|{question_id}|{model}|{round(temperature, 2)}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _path(key: str) -> Path:
    """샤딩: 첫 2자를 디렉토리로 → 한 디렉토리에 너무 많은 파일 안 쌓이도록."""
    return BASE_DIR / key[:2] / f"{key}.json"


def get(key: str) -> Answer | None:
    p = _path(key)
    if not p.exists():
        return None
    try:
        return Answer.model_validate_json(p.read_text(encoding="utf-8"))
    except Exception:
        # 캐시 손상 시 무시 (재호출로 회복)
        return None


def put(key: str, answer: Answer) -> None:
    p = _path(key)
    p.parent.mkdir(parents=True, exist_ok=True)
    content = answer.model_dump_json(indent=2)
    with _lock:
        fd, tmp = tempfile.mkstemp(dir=str(p.parent), prefix=".tmp_")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(content)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, p)
        except Exception:
            if os.path.exists(tmp):
                os.unlink(tmp)
            raise


def invalidate(prefix: str = "") -> int:
    """캐시 무효화. prefix가 비면 전체, 아니면 sha256 앞자리로 부분 삭제. 삭제된 건수 반환."""
    if not BASE_DIR.exists():
        return 0
    deleted = 0
    with _lock:
        for shard in BASE_DIR.iterdir():
            if not shard.is_dir():
                continue
            for f in shard.glob("*.json"):
                if prefix and not f.stem.startswith(prefix):
                    continue
                try:
                    f.unlink()
                    deleted += 1
                except OSError:
                    pass
    return deleted


def stats() -> dict:
    """캐시 디스크 사용량 정보 (디버그용)."""
    if not BASE_DIR.exists():
        return {"file_count": 0, "bytes": 0}
    n = 0
    size = 0
    for shard in BASE_DIR.iterdir():
        if not shard.is_dir():
            continue
        for f in shard.glob("*.json"):
            n += 1
            try:
                size += f.stat().st_size
            except OSError:
                pass
    return {"file_count": n, "bytes": size}
