"""시스템 설정 라우터 (F9).

참조: SmartHaccp-MultiAgent app/routers/router_settings.py
"""
import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.config import settings as app_settings
from app.core.deps import get_current_user, require_role
from app.db import execute_write, fetch_all, _PH

router = APIRouter(prefix="/api/settings", tags=["settings"])

_MASKED_KEYS = {"anthropic_api_key", "openai_api_key", "google_api_key", "jwt_secret_key"}


def _mask(key: str, value: str) -> str:
    if key.lower() in _MASKED_KEYS and value:
        return value[:4] + "****"
    return value


@router.get("/")
async def get_settings(user: dict = Depends(get_current_user)):
    rows = await fetch_all("SELECT key, value, description, updated_at FROM tbl_settings ORDER BY key")
    return {
        "settings": [
            {**r, "value": _mask(r["key"], r.get("value") or "")}
            for r in rows
        ]
    }


class SettingUpdate(BaseModel):
    value: str
    description: str = ""


@router.put("/{key}")
async def update_setting(
    key: str,
    body: SettingUpdate,
    user: dict = Depends(require_role("supervisor", "admin")),
):
    await execute_write(
        f"""INSERT INTO tbl_settings (key, value, description, updated_at)
            VALUES ({_PH},{_PH},{_PH},CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value,
            description=excluded.description, updated_at=excluded.updated_at""",
        (key, body.value, body.description),
    )
    return {"message": "설정 저장 완료", "key": key}


@router.get("/ui-config")
async def get_ui_config():
    """UI 기능 플래그 — 인증 불필요."""
    return {
        "agent_create_mode": app_settings.agent_create_mode,
        "marketplace_enabled": app_settings.marketplace_enabled,  # R21
    }


@router.post("/test-llm")
async def test_llm(user: dict = Depends(get_current_user)):
    """LLM 연결 테스트."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{app_settings.ollama_base_url}/api/tags")
            ollama_ok = resp.status_code == 200
    except Exception:
        ollama_ok = False

    anthropic_ok = bool(app_settings.anthropic_api_key)
    return {"ollama": ollama_ok, "anthropic_configured": anthropic_ok}
