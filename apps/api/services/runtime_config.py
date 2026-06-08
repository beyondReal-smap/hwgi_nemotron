"""서버 전역 LLM 런타임 설정.

관리자 페이지에서 provider/모델을 변경하면 `data/llm_config.json`에 영속화되고,
`enforce_provider()`가 이 값을 읽어 **모든 LLM 호출에 전역으로 강제** 적용한다.
(설문/분석 요청이 보내는 provider 인자는 무시되고 이 전역 설정이 우선한다.)

uvicorn workers=1 단일 프로세스를 가정해 메모리 캐시를 둔다. save 시 캐시를 갱신한다.
"""

from __future__ import annotations

import json
from pathlib import Path
from threading import Lock

# services/runtime_config.py → services → apps/api → apps → ai_hack(루트) / data
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_CONFIG_PATH = _PROJECT_ROOT / "data" / "llm_config.json"

_LOCK = Lock()
_cache: dict | None = None

VALID_PROVIDERS = ("sllm", "anthropic", "openai")
_DEFAULTS = {"provider": "sllm", "openai_model": "gpt-5.4"}


def _read_disk() -> dict:
    try:
        with open(_CONFIG_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return dict(_DEFAULTS)
    merged = {**_DEFAULTS, **(data if isinstance(data, dict) else {})}
    if merged.get("provider") not in VALID_PROVIDERS:
        merged["provider"] = _DEFAULTS["provider"]
    if not isinstance(merged.get("openai_model"), str) or not merged["openai_model"].strip():
        merged["openai_model"] = _DEFAULTS["openai_model"]
    return merged


def load_llm_config() -> dict:
    """현재 전역 LLM 설정 dict. {'provider', 'openai_model'}."""
    global _cache
    if _cache is None:
        _cache = _read_disk()
    return dict(_cache)


def save_llm_config(*, provider: str, openai_model: str) -> dict:
    """전역 LLM 설정을 검증 후 원자적으로 저장하고 캐시를 갱신한다."""
    global _cache
    if provider not in VALID_PROVIDERS:
        raise ValueError(f"지원하지 않는 provider: {provider!r} (가능: {VALID_PROVIDERS})")
    model = (openai_model or "").strip() or _DEFAULTS["openai_model"]
    cfg = {"provider": provider, "openai_model": model}
    with _LOCK:
        _CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = _CONFIG_PATH.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        tmp.replace(_CONFIG_PATH)
        _cache = dict(cfg)
    return dict(cfg)
