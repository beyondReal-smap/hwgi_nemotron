"""기존 completed 설문에 대해 차트 리포트 총평을 1회 백필.

흐름:
  1) data/surveys/_index.json에서 status=completed 설문 ID 수집
  2) 이미 commentary.json이 있으면 skip (FORCE=1이면 재생성)
  3) services.commentary.generate_and_persist 호출 → disk에 캐시

사용법:
  cd apps/api && .venv/bin/python ../../scripts/backfill_commentaries.py
  FORCE=1 .venv/bin/python ../../scripts/backfill_commentaries.py    # 기존 캐시도 덮어쓰기

PROVIDER=anthropic|sllm 로 LLM 선택 가능 (기본: services.llm.DEFAULT_PROVIDER).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# apps/api를 import path에 추가 (services.* 접근용)
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_PROJECT_ROOT / "apps" / "api"))

from services import survey_repo  # noqa: E402
from services.commentary import generate_and_persist  # noqa: E402


def main() -> None:
    force = os.environ.get("FORCE", "0") == "1"
    provider = os.environ.get("PROVIDER")  # None → llm.DEFAULT_PROVIDER

    index_path = survey_repo.INDEX_PATH
    if not index_path.exists():
        print(f"❌ index 없음: {index_path}")
        return

    index = json.loads(index_path.read_text(encoding="utf-8"))
    completed = [sid for sid, meta in index.items() if meta.get("status") == "completed"]
    print(f"📋 completed 설문: {len(completed)}건")

    ok = skip = fail = 0
    for sid in completed:
        cache = survey_repo._commentary_path(sid)  # noqa: SLF001 — 백필 스크립트라 직접 접근 허용
        if cache.exists() and not force:
            print(f"  · skip {sid} (이미 존재, FORCE=1로 강제 가능)")
            skip += 1
            continue

        title = index[sid].get("title", "(제목 없음)")
        print(f"  ▶ {sid}  '{title}'")
        kwargs = {"provider": provider} if provider else {}
        text = generate_and_persist(sid, **kwargs)
        if text:
            print(f"    ✅ 생성 {len(text)}자")
            ok += 1
        else:
            print(f"    ⚠️  실패 (commentary.py 로그 확인)")
            fail += 1

    print(f"\n결과: 생성 {ok}건 · 스킵 {skip}건 · 실패 {fail}건")


if __name__ == "__main__":
    main()
