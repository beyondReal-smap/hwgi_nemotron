"""익명 방문 이벤트 영속화.

IP는 원문과 salt 해시를 함께 저장한다(2026-06-10 변경, 관리자 요청).
원문은 ADMIN_TOKEN으로 보호되는 관리자 화면에서만 노출하고, 해시는
레이트리밋 키·기존 레코드 호환용으로 유지한다. 브라우저가 보낸 식별자는
가명 식별자로만 취급한다.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any

from fastapi import Request

from services.fileio import append_jsonl
from services.pii_mask import mask_pii

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
DEFAULT_VISITORS_LOG = _PROJECT_ROOT / "data" / "visitors.jsonl"

# track은 무인증 공개 엔드포인트라 반복 호출로 로그 파일을 키우는 스팸이 가능하다.
# IP 해시별 슬라이딩 윈도우(60초)로 초과분을 차단한다. (--workers 1 전제의 인메모리)
_RATE_WINDOW_SEC = 60.0
_MAX_TRACKED_KEYS = 10_000
_rate_guard = threading.Lock()
_recent_hits: dict[str, deque[float]] = {}


def _rate_limit_max() -> int:
    return int(os.environ.get("VISITOR_RATE_LIMIT_MAX", "60"))


def rate_limited(ip_hash: str | None) -> bool:
    """윈도우 내 허용량을 넘으면 True. 넘지 않으면 이번 호출을 기록하고 False."""
    key = ip_hash or "unknown"
    now = time.monotonic()
    with _rate_guard:
        hits = _recent_hits.setdefault(key, deque())
        while hits and now - hits[0] > _RATE_WINDOW_SEC:
            hits.popleft()
        if len(hits) >= _rate_limit_max():
            return True
        hits.append(now)
        if len(_recent_hits) > _MAX_TRACKED_KEYS:
            stale = [
                k for k, v in _recent_hits.items()
                if not v or now - v[-1] > _RATE_WINDOW_SEC
            ]
            for k in stale:
                del _recent_hits[k]
        return False


def _log_path() -> Path:
    return Path(os.environ.get("VISITORS_LOG", str(DEFAULT_VISITORS_LOG)))


def _clean_text(value: Any, max_len: int) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return mask_pii(text[:max_len])


def _clean_int(value: Any, *, min_value: int = 0, max_value: int = 100_000) -> int | None:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    if n < min_value:
        return None
    return min(n, max_value)


def _client_ip(request: Request) -> str | None:
    for header in ("cf-connecting-ip", "x-real-ip", "x-forwarded-for"):
        value = request.headers.get(header)
        if not value:
            continue
        first = value.split(",", 1)[0].strip()
        if first:
            return first
    return request.client.host if request.client else None


def _ip_hash(ip: str | None) -> str | None:
    if not ip:
        return None
    salt = (
        os.environ.get("VISITOR_HASH_SALT")
        or os.environ.get("ADMIN_TOKEN")
        or "personafit-local-dev"
    )
    return hashlib.sha256(f"{salt}:{ip}".encode()).hexdigest()[:24]


def client_ip_hash(request: Request) -> str | None:
    return _ip_hash(_client_ip(request))


def record_visit(payload: dict[str, Any], request: Request) -> str:
    event_type = _clean_text(payload.get("event_type"), 50) or "page_view"
    record = {
        "visitor_id": _clean_text(payload.get("visitor_id"), 120),
        "session_id": _clean_text(payload.get("session_id"), 120),
        "path": _clean_text(payload.get("path"), 300),
        "event_type": event_type,
        "action": _clean_text(payload.get("action"), 80) or event_type,
        "target_tag": _clean_text(payload.get("target_tag"), 40),
        "target_role": _clean_text(payload.get("target_role"), 80),
        "target_id": _clean_text(payload.get("target_id"), 120),
        "target_name": _clean_text(payload.get("target_name"), 120),
        "target_type": _clean_text(payload.get("target_type"), 80),
        "target_label": _clean_text(payload.get("target_label"), 200),
        "target_href": _clean_text(payload.get("target_href"), 500),
        "page_title": _clean_text(payload.get("page_title"), 200),
        "referrer": _clean_text(payload.get("referrer"), 500),
        "language": _clean_text(payload.get("language"), 80),
        "timezone": _clean_text(payload.get("timezone"), 80),
        "screen_width": _clean_int(payload.get("screen_width")),
        "screen_height": _clean_int(payload.get("screen_height")),
        "viewport_width": _clean_int(payload.get("viewport_width")),
        "viewport_height": _clean_int(payload.get("viewport_height")),
        "user_agent": _clean_text(request.headers.get("user-agent"), 500),
        "accept_language": _clean_text(request.headers.get("accept-language"), 300),
        "ip": _client_ip(request),
        "ip_hash": client_ip_hash(request),
    }
    return append_jsonl(_log_path(), record, id_key="event_id")


def list_visits(limit: int = 200) -> list[dict]:
    """최신순 limit건 반환. 로그는 페이지뷰마다 누적되므로 마지막 N줄만 파싱한다."""
    safe_limit = max(1, min(int(limit), 1000))
    path = _log_path()
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as f:
        tail = deque(f, maxlen=safe_limit)
    records: list[dict] = []
    for line in tail:
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return records[::-1]
