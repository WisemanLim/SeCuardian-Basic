"""LLM 관리 라우터 (R19) — provider 상태 · 모델 목록 · 라우팅 · 사용량 집계."""
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.core.config import settings
from app.core.deps import get_current_user, require_role
from app.db import execute_write, _PH
from app.services import llm_metering, llm_providers, llm_router

router = APIRouter(prefix="/api/llm", tags=["llm"])


async def _merged_llm_settings() -> dict[str, str]:
    from app.agents.orchestrator import _db_llm_settings
    return await _db_llm_settings()


@router.get("/providers")
async def provider_status(user: dict = Depends(get_current_user)):
    """로컬 LLM provider 도달성/모델 목록 + Anthropic 설정 여부."""
    db = await _merged_llm_settings()
    default_provider, _, _ = llm_providers.resolve_local(db)
    results = []
    for p in llm_providers.PROVIDERS:
        base_key, model_key = llm_providers._PROVIDER_KEYS[p]
        base_url = db.get(base_key) or getattr(settings, base_key, "")
        status = await llm_providers.check_provider(p, base_url)
        status["base_url"] = base_url
        status["configured_model"] = db.get(model_key) or getattr(settings, model_key, "")
        status["is_default"] = p == default_provider
        results.append(status)
    return {
        "local_llm_provider": default_provider,
        "anthropic_configured": bool(settings.anthropic_api_key),
        "providers": results,
    }


@router.get("/models")
async def list_models(user: dict = Depends(get_current_user)):
    """AI 어시스턴트 모델 선택 옵션 — 로컬 provider + Claude 모델."""
    db = await _merged_llm_settings()
    provider, model, base_url = llm_providers.resolve_local(db)
    options: list[dict] = []
    # 로컬 옵션 — value 'ollama' 는 하위호환(백엔드 로컬 경로 스위치 값)
    local_label = f"Local — {provider}"
    if model:
        local_label += f": {model}"
    options.append({"value": "ollama", "label": local_label, "provider": provider})
    if settings.anthropic_api_key:
        orch = db.get("orchestrator_model") or settings.orchestrator_model
        domain = db.get("domain_agent_model") or settings.domain_agent_model
        options.append({"value": orch, "label": orch, "provider": "anthropic"})
        if domain != orch:
            options.append({"value": domain, "label": domain, "provider": "anthropic"})
    return {"models": options, "default": "ollama"}


@router.get("/routes")
async def get_routes(user: dict = Depends(require_role("supervisor", "admin"))):
    return {"routes": await llm_router.get_routes(), "tasks": list(llm_router.TASKS)}


class RoutesUpdate(BaseModel):
    routes: dict


@router.put("/routes")
async def put_routes(
    body: RoutesUpdate,
    user: dict = Depends(require_role("supervisor", "admin")),
):
    err = llm_router.validate_routes(body.routes)
    if err:
        raise HTTPException(status_code=400, detail=err)
    await execute_write(
        f"""INSERT INTO tbl_settings (key, value, description, updated_at)
            VALUES ({_PH},{_PH},{_PH},CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value,
            description=excluded.description, updated_at=excluded.updated_at""",
        ("llm_routes", json.dumps(body.routes, ensure_ascii=False), "R19-2 작업별 LLM 라우팅"),
    )
    return {"message": "라우팅 저장 완료", "routes": body.routes}


@router.get("/usage")
async def usage(
    group_by: str = Query("model"),
    days: int = Query(30, ge=1, le=365),
    user: dict = Depends(require_role("supervisor", "admin")),
):
    """LLM 호출 사용량 집계 — group_by: model|provider|user|day|task."""
    rows = await llm_metering.aggregate(group_by=group_by, days=days)
    return {"group_by": group_by, "days": days, "rows": rows}
