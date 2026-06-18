from __future__ import annotations

import json
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from routes.visitors import router


def test_track_visit_stores_ip_and_hash(tmp_path, monkeypatch) -> None:
    # 원본 IP는 관리 도구(admind/visitors) 식별용으로 의도적으로 저장한다 (2026-06-11 확정).
    # 레이트리밋 등 익명 키 용도로 솔트 해시(ip_hash)도 함께 기록한다.
    log_path = tmp_path / "visitors.jsonl"
    monkeypatch.setenv("VISITORS_LOG", str(log_path))
    monkeypatch.setenv("VISITOR_HASH_SALT", "test-salt")

    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    response = client.post(
        "/api/visitors/track",
        json={
            "visitor_id": "visitor_1",
            "session_id": "session_1",
            "path": "/intro",
            "page_title": "PersonaFit",
            "referrer": "https://example.com/source",
            "language": "ko-KR",
            "timezone": "Asia/Seoul",
            "screen_width": 1920,
            "screen_height": 1080,
            "viewport_width": 1440,
            "viewport_height": 900,
        },
        headers={
            "X-Forwarded-For": "203.0.113.9, 10.0.0.1",
            "User-Agent": "pytest-browser",
        },
    )

    assert response.status_code == 200
    text = log_path.read_text(encoding="utf-8")

    record = json.loads(text)
    assert record["event_id"] == response.json()["event_id"]
    assert record["path"] == "/intro"
    assert record["event_type"] == "page_view"
    assert record["action"] == "page_view"
    assert record["visitor_id"] == "visitor_1"
    # X-Forwarded-For 첫 값(클라이언트)만 채택 — 프록시 체인 뒷단은 버린다.
    assert record["ip"] == "203.0.113.9"
    assert record["ip_hash"]
    assert record["user_agent"] == "pytest-browser"


def test_track_visit_stores_action_details(tmp_path, monkeypatch) -> None:
    log_path = tmp_path / "visitors.jsonl"
    monkeypatch.setenv("VISITORS_LOG", str(log_path))

    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    response = client.post(
        "/api/visitors/track",
        json={
            "visitor_id": "visitor_1",
            "session_id": "session_1",
            "path": "/analyze",
            "event_type": "click",
            "action": "click",
            "target_tag": "button",
            "target_role": "button",
            "target_type": "submit",
            "target_label": "분석 실행",
        },
    )

    assert response.status_code == 200
    record = json.loads(log_path.read_text(encoding="utf-8"))
    assert record["event_type"] == "click"
    assert record["action"] == "click"
    assert record["target_tag"] == "button"
    assert record["target_role"] == "button"
    assert record["target_type"] == "submit"
    assert record["target_label"] == "분석 실행"


def test_list_visits_requires_admin_token(tmp_path, monkeypatch) -> None:
    log_path = tmp_path / "visitors.jsonl"
    monkeypatch.setenv("VISITORS_LOG", str(log_path))
    monkeypatch.setenv("ADMIN_TOKEN", "admin-secret")

    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    client.post(
        "/api/visitors/track",
        json={"visitor_id": "visitor_1", "session_id": "session_1", "path": "/intro"},
    )

    blocked = client.get("/api/visitors")
    allowed = client.get("/api/visitors", headers={"X-Admin-Token": "admin-secret"})

    assert blocked.status_code == 403
    assert allowed.status_code == 200
    body = allowed.json()
    assert body["count"] == 1
    assert body["items"][0]["path"] == "/intro"


def test_track_visit_rate_limited(tmp_path, monkeypatch) -> None:
    log_path = tmp_path / "visitors.jsonl"
    monkeypatch.setenv("VISITORS_LOG", str(log_path))
    monkeypatch.setenv("VISITOR_RATE_LIMIT_MAX", "3")

    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    payload = {"visitor_id": "visitor_1", "session_id": "session_1", "path": "/intro"}
    # 다른 테스트와 인메모리 카운터가 섞이지 않도록 이 테스트 전용 IP 사용
    headers = {"X-Forwarded-For": "198.51.100.77"}

    statuses = [
        client.post("/api/visitors/track", json=payload, headers=headers).status_code
        for _ in range(5)
    ]

    assert statuses == [200, 200, 200, 429, 429]
    stored = [line for line in log_path.read_text(encoding="utf-8").splitlines() if line]
    assert len(stored) == 3
