"""LLM Route (R19-2) — 작업(task) 단위 provider/model 라우팅.

tbl_settings.llm_routes(JSON) 예:
  {"classify": {"provider": "ollama", "model": "qwen2.5:3b"},
   "tools":    {"provider": "anthropic", "model": "claude-sonnet-4-6"},
   "chat":     {"provider": "vllm"}}
- task: classify | tools | synthesize | domain | chat
- provider: anthropic | ollama | llamacpp | vllm
- model/base_url 미지정 시 provider 기본 설정으로 보충
- 미지정 task 는 None 반환 → 기존 동작(요청 model 문자열 이진 분기) 유지
"""
import json
import logging

from app.core.config import settings
from app.services.llm_providers import PROVIDERS, _PROVIDER_KEYS

logger = logging.getLogger("uvicorn.error")

TASKS = ("classify", "tools", "synthesize", "domain", "chat")
_VALID_PROVIDERS = ("anthropic",) + PROVIDERS


async def get_routes() -> dict:
    """tbl_settings.llm_routes JSON 파싱 (없으면 {})."""
    try:
        from app.db import fetch_one, _PH
        row = await fetch_one(f"SELECT value FROM tbl_settings WHERE key = {_PH}", ("llm_routes",))
        if row and row.get("value"):
            parsed = json.loads(row["value"])
            if isinstance(parsed, dict):
                return parsed
    except Exception as exc:  # noqa: BLE001
        logger.warning("[llm_router] llm_routes 파싱 실패 (무시): %s", exc)
    return {}


def validate_routes(routes: dict) -> str | None:
    """저장 전 검증 — 오류 메시지 반환(정상 시 None)."""
    if not isinstance(routes, dict):
        return "llm_routes 는 JSON object 여야 합니다"
    for task, spec in routes.items():
        if task not in TASKS:
            return f"알 수 없는 task: {task} (허용: {', '.join(TASKS)})"
        if not isinstance(spec, dict):
            return f"{task}: object 형식이어야 합니다"
        provider = spec.get("provider", "")
        if provider and provider not in _VALID_PROVIDERS:
            return f"{task}: 알 수 없는 provider '{provider}' (허용: {', '.join(_VALID_PROVIDERS)})"
    return None


async def resolve(task: str, db: dict[str, str] | None = None) -> dict | None:
    """task 라우트 해석 → {'provider','model','base_url'} 또는 None(라우트 미지정).

    db: _db_llm_settings() 병합값 — provider 기본 model/base_url 보충에 사용.
    """
    routes = await get_routes()
    spec = routes.get(task)
    if not isinstance(spec, dict) or not spec.get("provider"):
        return None
    provider = spec["provider"]
    if provider not in _VALID_PROVIDERS:
        return None
    db = db or {}
    if provider == "anthropic":
        model = spec.get("model") or db.get("orchestrator_model") or settings.orchestrator_model
        return {"provider": "anthropic", "model": model, "base_url": ""}
    base_key, model_key = _PROVIDER_KEYS[provider]
    model = spec.get("model") or db.get(model_key) or getattr(settings, model_key, "") or ""
    base_url = spec.get("base_url") or db.get(base_key) or getattr(settings, base_key, "") or ""
    return {"provider": provider, "model": model, "base_url": base_url}
