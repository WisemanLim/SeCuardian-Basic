"""MCP JSON-RPC 2.0 endpoint — Hybrid/Standalone mode (F12).

Spec: https://spec.modelcontextprotocol.io (2025-11-05)
Transport: Streamable HTTP (POST /mcp, POST /mcp/{agent_key})

각 Addon Agent가 개별 MCP 서버로 동작:
  POST /mcp/{agent_key}            — per-agent MCP JSON-RPC 2.0
  GET  /mcp/{agent_key}/guide      — per-agent 가이드 + 클라이언트 설정
  POST /mcp                        — 전체 통합 엔드포인트 (모든 active addon tools)
  GET  /mcp/guide                  — 전체 가이드
"""
import json
import logging
import re
import secrets
import socket

import httpx
from fastapi import APIRouter, Request

logger = logging.getLogger("uvicorn.error")
router = APIRouter(tags=["mcp"])


def _get_server_host() -> str:
    """Detect LAN IP of this server (not localhost) for MCP URL generation."""
    from app.core.config import settings
    if settings.mcp_host:
        return settings.mcp_host
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "localhost"


def _ok(id_: object, result: object) -> dict:
    return {"jsonrpc": "2.0", "id": id_, "result": result}


def _err(id_: object, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": id_, "error": {"code": code, "message": message}}


async def _fetch_openapi_spec() -> dict:
    from app.main import app as _app
    transport = httpx.ASGITransport(app=_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as c:
        resp = await c.get("/openapi.json")
        return resp.json() if resp.status_code == 200 else {}


async def _get_addon_tools() -> list[dict]:
    """전체 활성 Addon → MCP tool list."""
    from app.addon_agent_loader import _active_prefixes
    from app.services.openapi_to_mcp import openapi_to_mcp_tools

    if not _active_prefixes:
        return []
    spec = await _fetch_openapi_spec()
    if not spec:
        return []
    tools: list[dict] = []
    for prefix in _active_prefixes:
        tools.extend(openapi_to_mcp_tools(spec, path_prefix_filter=prefix))
    return tools


async def _get_agent_extra_args(agent_key: str) -> tuple[list[str], dict]:
    """tbl_mcp_configs.extra_args (custom args) 조회 → (raw list, key:val 파싱 맵).

    MCP 클라이언트에 노출용 설정 메타. `"key:val"` 형식은 {key: val} 로,
    값 없는 항목은 {key: true} 로 파싱한다 (McpEditModal 저장 규칙과 일치, #4).
    """
    try:
        from app.db import fetch_one, _PH
        row = await fetch_one(
            f"SELECT extra_args FROM tbl_mcp_configs WHERE agent_key = {_PH}",
            (agent_key,),
        )
    except Exception:
        return [], {}
    if not row or not row.get("extra_args"):
        return [], {}
    try:
        raw = json.loads(row["extra_args"])
    except Exception:
        return [], {}
    if not isinstance(raw, list):
        return [], {}
    parsed: dict = {}
    for item in raw:
        if not isinstance(item, str):
            continue
        idx = item.find(":")
        if idx > 0:
            parsed[item[:idx]] = item[idx + 1:]
        elif item:
            parsed[item] = True
    return raw, parsed


# ── MCP 서비스 인증 — x-api-key 검증 → 서비스 계정 JWT 발급 (#5) ──────────────
# 외부 MCP 클라이언트(Claude Desktop 등)는 Authorization 헤더를 보내지 않아 내부 API
# 호출이 401/403 이 된다. mcp-remote 의 `--header x-api-key:<키>` 로 전달된 API 키를
# extra_args `api_key:<키>` 또는 .env MCP_API_KEY 와 대조하고, 통과 시 관리자가 지정한
# tbl_users 실계정(extra_args `auth_user:<user_id>` 또는 .env MCP_AUTH_USER)으로
# JWT_SECRET_KEY 서명 토큰을 발급해 orchestrator/chat/내장/addon tool 에 권한 부여.
# 우선순위: ① 요청 Authorization 헤더 ② x-api-key + auth_user (API 키 미설정 시 auth_user 만).

async def _mint_service_token(user_id: str) -> str | None:
    """tbl_users 활성 계정 조회 → 로그인과 동일한 페이로드로 JWT 발급."""
    from app.core.security import create_access_token
    try:
        from app.db import fetch_one, _PH
        user = await fetch_one(
            f"SELECT user_id, username, role, status FROM tbl_users WHERE user_id = {_PH}",
            (user_id,),
        )
    except Exception as exc:
        logger.error("[mcp] service auth 사용자 조회 실패(%s): %s", user_id, exc)
        return None
    if not user or user.get("status") != "active":
        logger.warning("[mcp] service auth 계정 없음/비활성: %s", user_id)
        return None
    return create_access_token({
        "sub": user["user_id"],
        "role": user["role"],
        "username": user.get("username") or user["user_id"],
    })


def _extra_api_key(extra_config: dict) -> str:
    """커스텀인자에서 API 키 추출 — `api_key:<키>` 우선, `--header:x-api-key:<키>` 형식도 허용."""
    val = str(extra_config.get("api_key") or "").strip()
    if val:
        return val
    header = str(extra_config.get("--header") or "").strip()
    if header.lower().startswith("x-api-key:"):
        return header[len("x-api-key:"):].strip()
    return ""


async def _resolve_auth_header(
    agent_key: str | None, auth_header: str, api_key: str = "", trusted: bool = False,
) -> str:
    """Authorization 헤더가 없으면 x-api-key 검증 후 서비스 계정 JWT 로 대체.

    API 키가 설정돼 있으면 반드시 일치해야 하며, 통과 시 auth_user 미지정이면
    기본 관리자 계정(DEFAULT_ADMIN_USER_ID)으로 발급. 키 미설정 + auth_user 만
    설정이면 무키 발급. 둘 다 미설정이면 빈 문자열(기존 동작 — 내부 API 401/403).

    trusted=True — per-agent 전용 프록시 포트(관리자가 에이전트 관리에서 등록) 경유.
    등록된 커스텀인자를 프록시가 대신 제시한 것으로 간주해 x-api-key 검증을 생략하고
    서비스 계정 JWT 를 발급한다 (클라이언트는 헤더 불필요).
    """
    if auth_header:
        return auth_header
    from app.core.config import settings
    extra_config: dict = {}
    if agent_key:
        _, extra_config = await _get_agent_extra_args(agent_key)
    expected_key = _extra_api_key(extra_config) or settings.mcp_api_key.strip()
    user_id = str(extra_config.get("auth_user") or "").strip() or settings.mcp_auth_user.strip()
    if expected_key:
        if api_key:
            # 클라이언트가 x-api-key 를 제시하면 채널과 무관하게 항상 검증
            if not secrets.compare_digest(api_key, expected_key):
                logger.warning("[mcp] x-api-key 불일치 (agent=%s)", agent_key or "-")
                return ""
        elif not trusted:
            # 미제시 — 전용 프록시 포트(trusted)만 등록 커스텀인자로 대체 허용
            logger.warning("[mcp] x-api-key 누락 (agent=%s)", agent_key or "-")
            return ""
    if trusted or expected_key:
        # 키 검증 통과 또는 신뢰 채널 — 계정 미지정 시 기본 관리자 계정으로 발급
        user_id = user_id or (settings.default_admin_user_id or "").strip()
    if not user_id:
        return ""
    token = await _mint_service_token(user_id)
    return f"Bearer {token}" if token else ""


# ── Orchestrator / AI Assistant — 내장 대화형 에이전트 MCP 개방 (#2) ──────────
# 외부 MCP 클라이언트가 SeCuardian-Basic 의 Orchestrator/AI 어시스턴트를 도구로 등록·호출.
# addon/내장 모니터 에이전트와 달리 REST 매핑이 아니라 Orchestrator.run() 을 직접 실행.
_ORCHESTRATOR_TOOLS: dict[str, dict] = {
    "general": {
        "name": "orchestrate",
        "description": (
            "SeCuardian-Basic Orchestrator — 사용자 요청 의도를 분류하고 적합한 보안 에이전트로 "
            "라우팅·합성해 답변합니다. 플랫폼 전반의 자연어 질의에 사용하세요."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "message": {"type": "string", "description": "사용자 질의/요청 (자연어)"},
                "model": {"type": "string", "description": "LLM 모델 (선택: ollama | claude-sonnet-4-6 등)"},
            },
            "required": ["message"],
        },
    },
    "chat": {
        "name": "chat",
        "description": (
            "SeCuardian-Basic AI 어시스턴트 — 플랫폼 질의응답과 데이터 조회·생성·수정·삭제를 "
            "수행합니다. 활성 에이전트의 API 를 통해 실제 작업을 처리합니다."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "message": {"type": "string", "description": "사용자 질의/요청 (자연어)"},
                "model": {"type": "string", "description": "LLM 모델 (선택: ollama | claude-sonnet-4-6 등)"},
            },
            "required": ["message"],
        },
    },
}


async def _is_orchestrator_enabled(agent_key: str) -> bool:
    """general/chat 이 tbl_agent_config 에서 활성인지 확인."""
    try:
        from app.db import fetch_one, _PH
        row = await fetch_one(
            f"SELECT agent_key FROM tbl_agent_config WHERE agent_key = {_PH} AND is_enabled = 1",
            (agent_key,),
        )
        return bool(row)
    except Exception:
        # DB 조회 실패 시에도 필수 대화형 에이전트는 노출 허용
        return True


async def _exec_orchestrator_tool(agent_key: str, input_args: dict, auth_header: str) -> str:
    """Orchestrator.run() 실행 → 텍스트 응답 (MCP tools/call 용, #2)."""
    from app.agents.orchestrator import Orchestrator
    message = str(input_args.get("message", "")).strip()
    if not message:
        return "message 파라미터가 필요합니다."
    history = input_args.get("history") or []
    model = input_args.get("model")
    token = auth_header[7:] if auth_header.lower().startswith("bearer ") else (auth_header or None)
    try:
        return await Orchestrator().run(
            message, history if isinstance(history, list) else [], model,
            user_id=None, token=token, agent_key=None,
        )
    except Exception as exc:
        logger.error("[mcp] orchestrator tool 실행 실패(%s): %s", agent_key, exc)
        return f"처리 중 오류가 발생했습니다: {exc}"


async def _get_agent_tools(agent_key: str) -> tuple[list[dict], str | None]:
    """특정 agent_key의 MCP tool list + prefix 반환 (orchestrator + addon + builtin 공통)."""
    # 0. Orchestrator / AI 어시스턴트 — 대화형 도구 노출 (#2)
    if agent_key in _ORCHESTRATOR_TOOLS:
        if await _is_orchestrator_enabled(agent_key):
            return [_ORCHESTRATOR_TOOLS[agent_key]], agent_key
        return [], None

    try:
        from app.db import fetch_one, _PH

        # 1. Addon agent — api_prefix 기반 OpenAPI 필터
        addon_row = await fetch_one(
            f"SELECT api_prefix FROM tbl_addon_agents WHERE agent_key = {_PH} AND is_active = 1",
            (agent_key,),
        )
        if addon_row:
            prefix: str = addon_row["api_prefix"]
            from app.addon_agent_loader import _active_prefixes
            if prefix not in _active_prefixes:
                return [], None
            spec = await _fetch_openapi_spec()
            if not spec:
                return [], None
            from app.services.openapi_to_mcp import openapi_to_mcp_tools
            return openapi_to_mcp_tools(spec, path_prefix_filter=prefix), prefix

        # 2. Builtin 에이전트 — is_enabled 확인, tool 없이 alive 표시만
        builtin_row = await fetch_one(
            f"SELECT agent_key FROM tbl_agent_config WHERE agent_key = {_PH} AND is_enabled = 1 AND is_required = 0",
            (agent_key,),
        )
        if builtin_row:
            return [], agent_key  # tool 없음, alive=True

    except Exception:
        pass

    return [], None


async def _exec_addon_tool(tool: dict, input_args: dict, auth_header: str) -> str:
    from app.main import app as _app

    meta = tool.get("_meta", {})
    method = meta.get("method", "GET")
    path = meta.get("path", "")
    args = dict(input_args)

    path = re.sub(r"\{([^}]+)\}", lambda m: str(args.pop(m.group(1), m.group(0))), path)
    headers = {"Authorization": auth_header} if auth_header else {}

    transport = httpx.ASGITransport(app=_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as c:
        fn = getattr(c, method.lower())
        kwargs: dict = {"headers": headers}
        if method in ("GET", "HEAD", "DELETE"):
            kwargs["params"] = args
        else:
            kwargs["json"] = args
        try:
            resp = await fn(path, **kwargs)
            return f"HTTP {resp.status_code}\n{resp.text}"
        except Exception as exc:
            return f"HTTP ERROR\n{json.dumps({'error': str(exc)})}"


def _client_configs(agent_key: str, mcp_url: str, api_key: str = "") -> dict:
    # Claude Desktop 은 mcp-remote 브리지 사용 — API 키 설정 시 x-api-key 헤더를,
    # http(비 TLS) URL 은 mcp-remote 가 기본 거부하므로 --allow-http 를 기본 포함 (#6)
    remote_args = ["mcp-remote", mcp_url]
    if api_key:
        remote_args += ["--header", f"x-api-key:{api_key}"]
    if mcp_url.startswith("http://"):
        remote_args.append("--allow-http")
    return {
        "claude_desktop": {
            "description": "~/.config/claude/claude_desktop_config.json 에 추가",
            "config": {"mcpServers": {agent_key: {"command": "npx", "args": remote_args}}},
        },
        "cursor": {
            "description": ".cursor/mcp.json 에 추가",
            "config": {"mcpServers": {agent_key: {"type": "http", "url": mcp_url}}},
        },
        "vscode_continue": {
            "description": ".continue/config.json mcp 섹션에 추가",
            "config": {"name": agent_key, "transport": {"type": "http", "url": mcp_url}},
        },
    }


# ── Per-agent endpoints ───────────────────────────────────────────────────────

@router.get("/mcp/guide")
async def mcp_guide(request: Request):
    """전체 통합 MCP 가이드 (모든 활성 addon tools)."""
    from urllib.parse import urlparse
    server_host = _get_server_host()
    parsed = urlparse(str(request.base_url))
    port_part = f":{parsed.port}" if parsed.port else ""
    mcp_url = f"http://{server_host}{port_part}/mcp"
    tools = await _get_addon_tools()
    from app.core.config import settings
    return {
        "mcp_url": mcp_url,
        "transport": "Streamable HTTP (POST)",
        "protocol": "MCP JSON-RPC 2.0 (2025-11-05)",
        "active_tools_count": len(tools),
        "active_tools": [{"name": t["name"], "description": t["description"]} for t in tools],
        "client_configs": _client_configs("wise-multiagent", mcp_url, settings.mcp_api_key.strip()),
    }


@router.get("/mcp/{agent_key}/guide")
async def mcp_agent_guide(agent_key: str, request: Request):
    """Per-agent MCP 가이드 — 활성 상태·tool 목록·클라이언트 설정 스니펫."""
    tools, prefix = await _get_agent_tools(agent_key)
    extra_args, extra_config = await _get_agent_extra_args(agent_key)

    # MCP config 조회 — 읽기 전용. 포트 할당/기동은 PUT /api/mcp-configs/{agent_key}
    # (mcp_proxy_server.start) 에서만 수행 — 여기서 self-assign 하면 실제로 리스닝하는
    # 프로세스 없이 DB에 port만 기록되어 "가이드엔 나오는데 연결 안 됨" 상태가 된다.
    proxy_port: int | None = None
    try:
        from app.db import fetch_one, _PH as _PH2
        cfg = await fetch_one(
            f"SELECT port FROM tbl_mcp_configs WHERE agent_key = {_PH2} AND is_enabled = 1",
            (agent_key,),
        )
        if cfg and cfg["port"]:
            proxy_port = int(cfg["port"])
    except Exception:
        pass

    # TCP liveness: proxy_port 있으면 실제 연결 시도, 없으면 _active_prefixes 폴백
    if proxy_port:
        try:
            with socket.create_connection(("localhost", proxy_port), timeout=1):
                is_alive = True
        except OSError:
            is_alive = False
    else:
        from app.addon_agent_loader import _active_prefixes
        is_alive = bool(prefix and (prefix in _active_prefixes or prefix == agent_key))

    server_host = _get_server_host()
    # A2A 는 프록시 포트가 아니라 메인 앱 포트에서 서비스됨 (router_a2a) — base_url 기준
    from urllib.parse import urlparse
    _parsed_base = urlparse(str(request.base_url))
    port_part_a2a = f":{_parsed_base.port}" if _parsed_base.port else ""
    if proxy_port:
        mcp_url = f"http://{server_host}:{proxy_port}/mcp"
    else:
        mcp_url = f"http://{server_host}{port_part_a2a}/mcp/{agent_key}"

    # 서비스 인증 API 키 — extra_args `api_key`/`--header` 우선, 없으면 .env MCP_API_KEY (#5)
    # 전용 프록시 포트는 헤더 없이도 동작(trusted)하나, 제시 시에도 유효 → 가이드에 포함 (#7)
    from app.core.config import settings
    api_key = _extra_api_key(extra_config) or settings.mcp_api_key.strip()

    return {
        "agent_key": agent_key,
        "mcp_url": mcp_url,
        "proxy_port": proxy_port,
        "server_host": server_host,
        "is_alive": is_alive,
        "transport": "Streamable HTTP (POST)",
        "protocol": "MCP JSON-RPC 2.0 (2025-11-05)",
        "extra_args": extra_args,      # custom args 원본 (#4)
        "config": extra_config,        # key:val 파싱 맵 (MCP 클라이언트 설정 메타)
        "is_orchestrator": agent_key in _ORCHESTRATOR_TOOLS,  # 대화형 에이전트 여부 (#2)
        # Orchestrator/AI 어시스턴트는 A2A Protocol 로도 개방됨 (#2)
        "a2a": (
            {
                "agent_card_url": f"http://{server_host}{port_part_a2a}/.well-known/agent-card.json",
                "tasks_endpoint": f"http://{server_host}{port_part_a2a}/a2a/tasks",
            }
            if agent_key in _ORCHESTRATOR_TOOLS else None
        ),
        "active_tools_count": len(tools),
        "active_tools": [{"name": t["name"], "description": t["description"]} for t in tools],
        "client_configs": _client_configs(agent_key, mcp_url, api_key),
    }


@router.post("/mcp/{agent_key}")
async def mcp_agent_endpoint(agent_key: str, body: dict, request: Request):
    """Per-agent MCP JSON-RPC 2.0 — 해당 agent의 API만 tool로 노출."""
    return await mcp_agent_rpc(
        agent_key, body,
        auth_header=request.headers.get("authorization", ""),
        api_key=request.headers.get("x-api-key", ""),
    )


async def mcp_agent_rpc(
    agent_key: str, body: dict,
    auth_header: str = "", api_key: str = "", trusted: bool = False,
) -> dict:
    """Per-agent MCP JSON-RPC 처리 본체.

    trusted=True — mcp_proxy_server(전용 프록시 포트) 경유 호출. 관리자가 등록한
    커스텀인자(api_key/auth_user)를 프록시가 대신 제시한 것으로 간주 (#7).
    HTTP 로 스푸핑 불가 — FastAPI 라우트는 항상 trusted=False 로 위임.
    """
    method = body.get("method", "")
    id_ = body.get("id")
    params = body.get("params", {})

    if method == "initialize":
        _, extra_config = await _get_agent_extra_args(agent_key)
        result = {
            "protocolVersion": params.get("protocolVersion", "2025-11-05"),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": f"wise-agent-{agent_key}", "version": "1.0.0"},
        }
        if extra_config:
            # custom args → MCP 응답 설정 메타로 노출 (#4). _meta 는 MCP 스펙 확장 필드.
            result["_meta"] = {"config": extra_config}
        return _ok(id_, result)

    tools, _ = await _get_agent_tools(agent_key)

    if method == "tools/list":
        return _ok(id_, {"tools": [
            {"name": t["name"], "description": t["description"],
             "inputSchema": t.get("inputSchema", {"type": "object", "properties": {}})}
            for t in tools
        ]})

    if method == "tools/call":
        tool_name = params.get("name", "")
        tool_input = params.get("arguments", {})
        matched = next((t for t in tools if t["name"] == tool_name), None)
        if not matched:
            return _err(id_, -32602, f"Unknown tool: {tool_name}")
        auth_header = await _resolve_auth_header(agent_key, auth_header, api_key, trusted)
        # Orchestrator/AI 어시스턴트 도구는 Orchestrator.run() 직접 실행 (#2)
        if agent_key in _ORCHESTRATOR_TOOLS:
            result = await _exec_orchestrator_tool(agent_key, tool_input, auth_header)
        else:
            result = await _exec_addon_tool(matched, tool_input, auth_header)
        return _ok(id_, {"content": [{"type": "text", "text": result}]})

    return _err(id_, -32601, f"Method not found: {method}")


# ── Global endpoint ───────────────────────────────────────────────────────────

@router.post("/mcp")
async def mcp_endpoint(body: dict, request: Request):
    """통합 MCP JSON-RPC 2.0 — 모든 활성 addon tools 노출."""
    method = body.get("method", "")
    id_ = body.get("id")
    params = body.get("params", {})
    auth_header = request.headers.get("authorization", "")

    if method == "initialize":
        return _ok(id_, {
            "protocolVersion": params.get("protocolVersion", "2025-11-05"),
            "capabilities": {"tools": {}, "resources": {}, "prompts": {}},
            "serverInfo": {"name": "secuardian-basic", "version": "1.0.0"},
        })

    if method == "tools/list":
        addon_tools = await _get_addon_tools()
        mcp_tools = [
            {"name": t["name"], "description": t["description"],
             "inputSchema": t.get("inputSchema", {"type": "object", "properties": {}})}
            for t in addon_tools
        ]
        logger.info("[mcp] tools/list → %d tools (addon)", len(mcp_tools))
        return _ok(id_, {"tools": mcp_tools})

    if method == "tools/call":
        tool_name = params.get("name", "")
        tool_input = params.get("arguments", {})
        auth_header = await _resolve_auth_header(
            None, auth_header, request.headers.get("x-api-key", ""))
        addon_tools = await _get_addon_tools()
        addon_tool = next((t for t in addon_tools if t["name"] == tool_name), None)
        if addon_tool:
            result = await _exec_addon_tool(addon_tool, tool_input, auth_header)
            return _ok(id_, {"content": [{"type": "text", "text": result}]})
        return _err(id_, -32602, f"Unknown tool: {tool_name}")

    if method == "resources/list":
        return _ok(id_, {"resources": [{"uri": "domain://context", "name": "Domain Context", "mimeType": "text/plain"}]})

    if method == "resources/read":
        uri = params.get("uri", "")
        if uri == "domain://context":
            return _ok(id_, {"contents": [{"uri": uri, "text": "(no domain context)"}]})
        return _err(id_, -32602, f"Unknown resource: {uri}")

    if method == "prompts/list":
        return _ok(id_, {"prompts": [{"name": "system", "description": "Agent system prompt"}]})

    if method == "prompts/get":
        name = params.get("name", "")
        if name == "system":
            return _ok(id_, {
                "messages": [{"role": "user", "content": {"type": "text", "text": "You are a helpful AI assistant."}}]
            })
        return _err(id_, -32602, f"Unknown prompt: {name}")

    return _err(id_, -32601, f"Method not found: {method}")
