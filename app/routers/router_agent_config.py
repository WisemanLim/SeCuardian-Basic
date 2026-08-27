"""Agent 설정 관리 라우터 (F8) — 활성화 토글·모델·프롬프트 변경."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.deps import get_current_user, require_role
from app.core.i18n import parse_lang_map as _parse_lang_dict  # R18-7 공통 파서로 일원화
from app.db import execute_write, fetch_all, fetch_one, _PH

router = APIRouter(prefix="/api/agent-config", tags=["agent-config"])


def _expand_descriptions(row: dict) -> dict:
    """R18-7: descriptions/agent_names JSON 문자열 → dict 변환(레거시 컬럼 폴백)."""
    d = _parse_lang_dict(row.get("descriptions"))
    if not d:
        if (row.get("description") or "").strip():
            d["ko"] = row["description"]
        if (row.get("description_en") or "").strip():
            d["en"] = row["description_en"]
    row["descriptions"] = d
    names = _parse_lang_dict(row.get("agent_names"))
    if not names and (row.get("agent_name") or "").strip():
        names["ko"] = row["agent_name"]
    row["agent_names"] = names
    return row


@router.get("/")
async def list_agents(user: dict = Depends(get_current_user)):
    rows = await fetch_all(
        "SELECT agent_key, agent_name, is_enabled, is_required, model, system_prompt, "
        "description, description_en, descriptions, agent_names, disabled_reason, disabled_reason_en, "
        "nav_group, sort_order, updated_at "
        "FROM tbl_agent_config ORDER BY sort_order, agent_key"
    )
    agents = [_expand_descriptions(r) for r in rows]
    # R22-5: worker 필요 여부 — 카드 설치 가이드 아이콘 상시 노출용 (addon 미등록 내장도 커버)
    from app.routers.router_addon_agent import _agent_worker_meta
    for a in agents:
        a["has_worker"] = _agent_worker_meta(a["agent_key"])[0] is not None
    return {"agents": agents}


@router.get("/{agent_key}")
async def get_agent(agent_key: str, user: dict = Depends(get_current_user)):
    row = await fetch_one(
        f"SELECT agent_key, agent_name, is_enabled, is_required, model, system_prompt, "
        f"description, description_en, descriptions, agent_names, disabled_reason, disabled_reason_en, "
        f"nav_group, sort_order, updated_at "
        f"FROM tbl_agent_config WHERE agent_key = {_PH}",
        (agent_key,),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found")
    return _expand_descriptions(row)


class AgentConfigPatch(BaseModel):
    is_enabled: bool | None = None
    model: str | None = None
    system_prompt: str | None = None


@router.patch("/{agent_key}")
async def patch_agent(
    agent_key: str,
    body: AgentConfigPatch,
    user: dict = Depends(require_role("supervisor", "admin")),
):
    row = await fetch_one(
        f"SELECT agent_key, is_required FROM tbl_agent_config WHERE agent_key = {_PH}", (agent_key,)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found")
    if row.get("is_required") and body.is_enabled is False:
        raise HTTPException(status_code=403, detail="필수 에이전트는 비활성화할 수 없습니다")

    sets: list[str] = []
    vals: list = []
    if body.is_enabled is not None:
        sets.append(f"is_enabled = {_PH}")
        vals.append(1 if body.is_enabled else 0)
    if body.model is not None:
        sets.append(f"model = {_PH}")
        vals.append(body.model)
    if body.system_prompt is not None:
        sets.append(f"system_prompt = {_PH}")
        vals.append(body.system_prompt)

    if not sets:
        return {"message": "Nothing to update"}

    sets.append("updated_at = CURRENT_TIMESTAMP")
    vals.append(agent_key)
    await execute_write(
        f"UPDATE tbl_agent_config SET {', '.join(sets)} WHERE agent_key = {_PH}",
        tuple(vals),
    )
    # addon 인 경우 tbl_addon_agents.is_active 동기화 + 활성화 시 라우터 핫 로드
    if body.is_enabled is not None:
        await execute_write(
            f"UPDATE tbl_addon_agents SET is_active = {_PH} WHERE agent_key = {_PH}",
            (1 if body.is_enabled else 0, agent_key),
        )
        addon_row = await fetch_one(
            f"SELECT router_path, api_prefix, sql_path FROM tbl_addon_agents WHERE agent_key = {_PH}",
            (agent_key,),
        )
        if addon_row and addon_row.get("api_prefix"):
            from app import addon_agent_loader
            if body.is_enabled:
                if addon_row.get("sql_path"):
                    await addon_agent_loader.apply_sql(addon_row["sql_path"])
                if addon_row.get("router_path"):
                    addon_agent_loader.load_router(
                        agent_key, addon_row["router_path"], addon_row["api_prefix"]
                    )
            else:
                addon_agent_loader.unload_router(agent_key, addon_row["api_prefix"])
    if body.is_enabled is False:
        await execute_write(
            f"DELETE FROM tbl_mcp_configs WHERE agent_key = {_PH}", (agent_key,)
        )
    result = {"message": "Updated", "agent_key": agent_key}
    # R22-3: 활성화 시 worker 필요 여부 안내 (내장 보안 에이전트 활성화 주경로)
    if body.is_enabled:
        from app.routers.router_addon_agent import _agent_worker_meta, _worker_summary
        worker, _src = _agent_worker_meta(agent_key)
        if worker:
            result["worker"] = _worker_summary(worker, agent_key)
    return result
