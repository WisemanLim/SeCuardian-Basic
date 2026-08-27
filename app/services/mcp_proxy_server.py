"""Per-agent MCP proxy servers — each agent's proxy_port runs its own HTTP server.

network_mode: host 환경에서 container 포트 = host 포트로 직접 접근 가능.
시작: upsert_mcp_config 저장 시 / 앱 시작 시 DB에서 복원.
"""
import asyncio
import logging

import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

logger = logging.getLogger("uvicorn.error")

# {agent_key: (uvicorn.Server, asyncio.Task)}
_servers: dict[str, tuple[uvicorn.Server, asyncio.Task]] = {}


def _make_agent_app(agent_key: str) -> Starlette:
    async def mcp_handler(request: Request):
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}, status_code=400)
        from app.routers.router_mcp import mcp_agent_rpc
        # 전용 프록시 포트 = 관리자 등록 채널 (trusted) — 등록된 커스텀인자(api_key/
        # auth_user)를 프록시가 대신 제시해 클라이언트는 x-api-key 헤더 불필요 (#7)
        result = await mcp_agent_rpc(
            agent_key, body,
            auth_header=request.headers.get("authorization", ""),
            api_key=request.headers.get("x-api-key", ""),
            trusted=True,
        )
        return JSONResponse(result)

    return Starlette(routes=[Route("/mcp", mcp_handler, methods=["POST"])])


async def start(agent_key: str, port: int) -> None:
    """Start per-agent MCP server on given port (idempotent)."""
    if agent_key in _servers:
        return

    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("0.0.0.0", port))
        except OSError:
            logger.warning("[mcp-proxy] %s port %d already in use, skipping", agent_key, port)
            return

    app = _make_agent_app(agent_key)
    config = uvicorn.Config(app, host="0.0.0.0", port=port, log_level="warning")
    server = uvicorn.Server(config)

    async def _serve_safe() -> None:
        try:
            await server.serve()
        except BaseException as exc:
            logger.warning("[mcp-proxy] %s port %d exited: %s", agent_key, port, exc)
            _servers.pop(agent_key, None)

    task = asyncio.create_task(_serve_safe(), name=f"mcp-proxy-{agent_key}")
    _servers[agent_key] = (server, task)
    logger.info("[mcp-proxy] %s → 0.0.0.0:%d", agent_key, port)


async def stop(agent_key: str) -> None:
    """Stop per-agent MCP server and release port."""
    pair = _servers.pop(agent_key, None)
    if not pair:
        return
    server, task = pair
    server.should_exit = True
    server.force_exit = True
    try:
        await asyncio.wait_for(asyncio.shield(task), timeout=3.0)
    except (asyncio.CancelledError, asyncio.TimeoutError, Exception):
        task.cancel()
        try:
            await asyncio.shield(task)
        except Exception:
            pass
    logger.info("[mcp-proxy] %s stopped", agent_key)


async def init_from_db() -> None:
    """Restore running servers from tbl_mcp_configs on app startup."""
    try:
        from app.db import fetch_all
        rows = await fetch_all(
            "SELECT agent_key, port FROM tbl_mcp_configs WHERE is_enabled = 1 AND port IS NOT NULL"
        )
        for row in rows:
            await start(row["agent_key"], int(row["port"]))
    except Exception as exc:
        logger.warning("[mcp-proxy] init_from_db failed: %s", exc)
