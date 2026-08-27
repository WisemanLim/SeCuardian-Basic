"""MCP Proxy 설정 관리 API — tbl_mcp_configs CRUD + 상태 확인 (F12 MCP)."""
import json
import logging
import socket

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.deps import get_current_user, require_role
from app.db import _PH, fetch_all, fetch_one, execute_write

logger = logging.getLogger("uvicorn.error")

router = APIRouter(prefix="/api/mcp-configs", tags=["mcp-configs"])


class McpConfigBody(BaseModel):
    port: int | None = None
    extra_args: list[str] = []
    is_enabled: bool = True


def _to_dict(row: dict) -> dict:
    return {
        "agent_key": row["agent_key"],
        "port": row["port"],
        "extra_args": json.loads(row["extra_args"]) if row["extra_args"] else [],
        "is_enabled": bool(row["is_enabled"]),
        "created_at": row["created_at"],
        "updated_at": row.get("updated_at"),
    }


@router.get("/")
async def list_mcp_configs(_: dict = Depends(get_current_user)):
    rows = await fetch_all("SELECT * FROM tbl_mcp_configs ORDER BY agent_key")
    return {"configs": [_to_dict(r) for r in rows]}


@router.get("/{agent_key}/status")
async def get_mcp_status(agent_key: str, _: dict = Depends(get_current_user)):
    """green=정상, orange=대기/연결중, red=비활성/오류."""
    row = await fetch_one(
        f"SELECT port, is_enabled FROM tbl_mcp_configs WHERE agent_key = {_PH}",
        (agent_key,),
    )
    if not row or not row["is_enabled"] or not row["port"]:
        return {"status": "red", "message": "MCP 프록시 미설정"}

    # 에이전트 비활성 → red
    addon = await fetch_one(
        f"SELECT is_active FROM tbl_addon_agents WHERE agent_key = {_PH}",
        (agent_key,),
    )
    if addon and not addon["is_active"]:
        return {"status": "red", "message": "에이전트 비활성"}

    try:
        with socket.create_connection(("localhost", int(row["port"])), timeout=1):
            return {"status": "green", "message": "정상"}
    except OSError:
        return {"status": "orange", "message": "MCP 프로세스 미시작"}


@router.get("/{agent_key}")
async def get_mcp_config(agent_key: str, _: dict = Depends(get_current_user)):
    row = await fetch_one(
        f"SELECT * FROM tbl_mcp_configs WHERE agent_key = {_PH}",
        (agent_key,),
    )
    if not row:
        # 미설정 상태도 가이드 확인이 가능하도록 기본값 반환
        return {
            "agent_key": agent_key,
            "port": None,
            "extra_args": [],
            "is_enabled": False,
            "created_at": None,
            "updated_at": None,
        }
    return _to_dict(row)


@router.put("/{agent_key}")
async def upsert_mcp_config(
    agent_key: str,
    body: McpConfigBody,
    user: dict = Depends(require_role("supervisor", "admin")),
):
    import random
    extra_json = json.dumps(body.extra_args, ensure_ascii=False)

    # 기존 설정 조회 (포트 변경 감지용)
    existing = await fetch_one(
        f"SELECT port FROM tbl_mcp_configs WHERE agent_key = {_PH}",
        (agent_key,),
    )
    old_port = int(existing["port"]) if existing and existing.get("port") else None

    # port=None → 자동할당 (20000-20019 — docker-compose.yml MCP_PORT_RANGE 발행 범위와 일치해야 함)
    new_port = body.port
    if new_port is None:
        used = {r["port"] for r in await fetch_all("SELECT port FROM tbl_mcp_configs WHERE port IS NOT NULL")}
        available = [p for p in range(20000, 20020) if p not in used]
        if not available:
            raise HTTPException(status_code=409, detail="사용 가능한 MCP 포트 없음 (20000-20019 전부 사용 중)")
        new_port = random.choice(available)

    from app.services import mcp_proxy_server

    # 포트 변경 또는 비활성화 → 기존 in-process MCP 서버 정지 (OS kill 아님 — 동일 프로세스이므로 SIGTERM 시 api 전체 종료 위험)
    if old_port and (old_port != new_port or not body.is_enabled):
        await mcp_proxy_server.stop(agent_key)

    if existing:
        await execute_write(
            f"UPDATE tbl_mcp_configs SET port={_PH}, extra_args={_PH}, is_enabled={_PH}, updated_at=CURRENT_TIMESTAMP WHERE agent_key={_PH}",
            (new_port, extra_json, int(body.is_enabled), agent_key),
        )
    else:
        await execute_write(
            f"INSERT INTO tbl_mcp_configs (agent_key, port, extra_args, is_enabled) VALUES ({_PH},{_PH},{_PH},{_PH})",
            (agent_key, new_port, extra_json, int(body.is_enabled)),
        )

    # MCP 등록 시 에이전트 활성화
    if body.is_enabled:
        await execute_write(
            f"UPDATE tbl_agent_config SET is_enabled=1 WHERE agent_key={_PH}",
            (agent_key,),
        )

    if not body.is_enabled:
        await mcp_proxy_server.stop(agent_key)
    elif new_port:
        await mcp_proxy_server.start(agent_key, new_port)

    row = await fetch_one(
        f"SELECT * FROM tbl_mcp_configs WHERE agent_key = {_PH}",
        (agent_key,),
    )
    return _to_dict(row)


@router.delete("/{agent_key}", status_code=204)
async def delete_mcp_config(
    agent_key: str,
    user: dict = Depends(require_role("supervisor", "admin")),
):
    row = await fetch_one(
        f"SELECT agent_key, port FROM tbl_mcp_configs WHERE agent_key = {_PH}",
        (agent_key,),
    )
    if not row:
        return  # idempotent — 없어도 204
    from app.services import mcp_proxy_server
    await mcp_proxy_server.stop(agent_key)
    await execute_write(
        f"DELETE FROM tbl_mcp_configs WHERE agent_key = {_PH}",
        (agent_key,),
    )
