# Standalone Agent Deployment Guide

> [한국어 →](README.md) · **F12 — A2A Protocol v1.0 + MCP JSON-RPC 2.0**

Package an Agent as an independent FastAPI service and expose it via A2A / MCP protocols.

---

## Table of Contents

1. [Modes](#1-modes)
2. [Environment-based Operation (.env)](#2-environment-based-operation-env)
3. [Running the Agent](#3-running-the-agent)
4. [A2A Registration & Calling Guide](#4-a2a-registration--calling-guide)
5. [MCP Registration & Calling Guide](#5-mcp-registration--calling-guide)
6. [Client Integrations](#6-client-integrations)
7. [Docker Build & Deployment](#7-docker-build--deployment)
8. [Agent Customization](#8-agent-customization)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Modes

| Mode | Description | Entry |
|------|-------------|-------|
| **Embedded** | Internal Orchestrator call (default) | Default — no config needed |
| **Standalone** | Independent FastAPI app (`:8001`) | `AGENT_KEY=example uv run uvicorn standalone.standalone_app:app --port 8001` |
| **Hybrid** | Main app + A2A/MCP exposed simultaneously | Set `AGENT_EXPOSE_PROTOCOL=a2a,mcp`, then `make dev-be` |

---

## 2. Environment-based Operation (.env)

### .env File Mapping

The `ENV` environment variable determines which `.env` file is loaded.

| `ENV` value | File loaded | DB | Purpose |
|-------------|-------------|----|---------|
| `local` (default) | `.env.local` | SQLite (`./local.db`) | Local development |
| `dev` | `.env.dev` | PostgreSQL | Development server |
| `staging` | `.env.staging` | PostgreSQL | Staging server |
| `prod` | `.env.prod` | PostgreSQL (HA) | Production |

### Env Variable Priority

```
1. Variables already exported in shell (highest)
2. Values in .env.{ENV} file
3. Default values in config.py (lowest)
```

### Preparing env files

```bash
# local — copy .env.example and set ANTHROPIC_API_KEY
cp .env.example .env.local
vi .env.local

# dev
cp .env.example .env.dev
# set DATABASE_URL, REDIS_URL, ANTHROPIC_API_KEY etc.

# staging / prod
cp .env.example .env.staging
cp .env.example .env.prod
```

### Key Standalone-specific env vars

```dotenv
# ── Standalone Agent ──────────────────────────────────────
ENV=local                            # local | dev | staging | prod
AGENT_STANDALONE=true                # auto-set by standalone_app.py
AGENT_KEY=example                    # agent identifier (AgentCard name)
AGENT_PORT=8001                      # listen port
AGENT_BASE_URL=http://localhost:8001 # public URL exposed in AgentCard
                                     # for Docker/server: https://agent.mycompany.com

# ── DB (differs per environment) ─────────────────────────
# local:
DATABASE_URL=sqlite:///./local.db

# dev/staging/prod:
DATABASE_URL=postgresql://app:app@postgres:5432/app_db

# ── MCP Host (Docker/NAT environments) ───────────────────
# Set explicitly when LAN IP auto-detection fails inside container
MCP_HOST=192.168.1.100
```

---

## 3. Running the Agent

### 3-1. local (SQLite, default)

```bash
# .env.local is loaded automatically (ENV omitted = local)
AGENT_KEY=example \
  uv run uvicorn standalone.standalone_app:app --reload --port 8001
```

Health check:

```bash
curl http://localhost:8001/health
# {
#   "status": "ok",
#   "agent": "example",
#   "mode": "standalone",
#   "env": "local",
#   "base_url": "http://localhost:8001",
#   "protocols": ["a2a", "mcp"]
# }
```

### 3-2. dev (requires PostgreSQL Docker service)

```bash
# After setting DATABASE_URL=postgresql://... in .env.dev
ENV=dev AGENT_KEY=example AGENT_BASE_URL=http://dev-server:8001 \
  uv run uvicorn standalone.standalone_app:app --port 8001
```

### 3-3. staging / prod

```bash
# staging
ENV=staging AGENT_KEY=example AGENT_BASE_URL=https://agent-staging.mycompany.com \
  uv run uvicorn standalone.standalone_app:app --host 0.0.0.0 --port 8001

# prod (workers: CPU cores × 2 + 1 recommended)
ENV=prod AGENT_KEY=example AGENT_BASE_URL=https://agent.mycompany.com \
  uv run uvicorn standalone.standalone_app:app --host 0.0.0.0 --port 8001 --workers 4
```

### 3-4. Make targets

```bash
# Package standalone (copy agent files + generate scripts)
make standalone AGENT=Example

# Build Docker image
make docker-standalone AGENT=Example
```

---

## 4. A2A Registration & Calling Guide

Based on A2A (Agent-to-Agent) Protocol v1.0.

### 4-1. Endpoint list

| Path | Method | Description | Auth |
|------|--------|-------------|------|
| `/.well-known/agent-card.json` | GET | Agent metadata (discovery) | None |
| `/a2a/tasks` | POST | Create task + async execution | Bearer |
| `/a2a/tasks/{id}` | GET | Subscribe to task SSE stream | Bearer |
| `/a2a/tasks/{id}/result` | GET | Retrieve final task result | Bearer |

### 4-2. Step 1 — AgentCard Discovery

External clients / Orchestrators discover Agent capabilities.

```bash
curl http://localhost:8001/.well-known/agent-card.json
```

Example response:

```json
{
  "name": "example",
  "description": "I am an AI assistant that helps with various tasks",
  "url": "http://localhost:8001",
  "version": "1.0.0",
  "capabilities": {
    "streaming": true,
    "tools": true
  },
  "skills": [
    {
      "id": "get_current_time",
      "name": "Get current time",
      "tags": []
    }
  ],
  "authentication": {
    "schemes": ["bearer"]
  }
}
```

### 4-3. Step 2 — Obtain JWT Token

A Bearer token is required for A2A task creation and retrieval.

```bash
TOKEN=$(curl -s -X POST http://localhost:8001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"user_id":"admin","password":"Admin123!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

echo $TOKEN
```

### 4-4. Step 3 — Create Task

```bash
TASK=$(curl -s -X POST http://localhost:8001/a2a/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "message": {
      "parts": [
        {"kind": "text", "text": "What time is it now?"}
      ]
    }
  }')

echo $TASK
# {"id": "550e8400-e29b-41d4-a716-446655440000", "status": "submitted"}

TASK_ID=$(echo $TASK | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
```

### 4-5. Step 4 — Subscribe to SSE Stream

Receive real-time status changes and result chunks during task processing.

```bash
curl -N http://localhost:8001/a2a/tasks/$TASK_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: text/event-stream"
```

Example SSE event stream:

```
event: status-update
data: {"state": "working"}

event: artifact-update
data: {"parts": [{"kind": "text", "text": "The current time is "}]}

event: artifact-update
data: {"parts": [{"kind": "text", "text": "3:42 PM on June 26, 2026."}]}

event: status-update
data: {"state": "completed"}
```

| Event | Meaning |
|-------|---------|
| `status-update` → `submitted` | Task queued |
| `status-update` → `working` | Agent processing |
| `artifact-update` | LLM response chunk (streaming) |
| `status-update` → `completed` | Processing done |
| `status-update` → `failed` | Processing failed |

### 4-6. Step 5 — Retrieve Final Result

Fetch the complete result after the stream ends.

```bash
curl http://localhost:8001/a2a/tasks/$TASK_ID/result \
  -H "Authorization: Bearer $TOKEN"
```

Response:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "artifacts": [
    {
      "parts": [
        {"kind": "text", "text": "The current time is 3:42 PM on June 26, 2026."}
      ]
    }
  ],
  "created_at": "2026-06-26T06:42:00Z"
}
```

### 4-7. Register A2A Agent with Main System

Register the Standalone Agent in the Agent Registry so the main Orchestrator can route to it.

```bash
# Get main system token
MAIN_TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"user_id":"admin","password":"Admin123!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Register agent (protocol=a2a)
curl -X POST http://localhost:8000/api/agent-registry/ \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_key": "example",
    "agent_name": "Example Standalone Agent",
    "protocol": "a2a",
    "agent_card_url": "http://localhost:8001/.well-known/agent-card.json",
    "mcp_endpoint": "",
    "auth_token": ""
  }'

# Verify registration
curl http://localhost:8000/api/agent-registry/ \
  -H "Authorization: Bearer $MAIN_TOKEN"

# Connection test (ping → GET agent card URL)
curl -X POST http://localhost:8000/api/agent-registry/example/ping \
  -H "Authorization: Bearer $MAIN_TOKEN"
# {"ok": true, "latency_ms": 12, "status_code": 200}

# Deregister
curl -X DELETE http://localhost:8000/api/agent-registry/example \
  -H "Authorization: Bearer $MAIN_TOKEN"
```

### 4-8. Python SDK Example

```python
import asyncio
import httpx

BASE = "http://localhost:8001"

async def run_a2a_task(message: str) -> str:
    async with httpx.AsyncClient() as client:
        # 1. Get token
        r = await client.post(f"{BASE}/api/auth/login",
            json={"user_id": "admin", "password": "Admin123!"})
        token = r.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 2. Create task
        r = await client.post(f"{BASE}/a2a/tasks", headers=headers,
            json={"message": {"parts": [{"kind": "text", "text": message}]}})
        task_id = r.json()["id"]

        # 3. Consume SSE stream
        full_text = ""
        async with client.stream("GET", f"{BASE}/a2a/tasks/{task_id}",
                                 headers={**headers, "Accept": "text/event-stream"}) as resp:
            async for line in resp.aiter_lines():
                if line.startswith("data:"):
                    import json
                    data = json.loads(line[5:].strip())
                    for part in data.get("parts", []):
                        if part.get("kind") == "text":
                            full_text += part["text"]
        return full_text

result = asyncio.run(run_a2a_task("What time is it now?"))
print(result)
```

---

## 5. MCP Registration & Calling Guide

MCP (Model Context Protocol) JSON-RPC 2.0 with Streamable HTTP transport.

### 5-1. Endpoint list

| Path | Method | Description | Auth |
|------|--------|-------------|------|
| `/mcp` | POST | Global MCP (all active Addon tools) | Bearer (optional) |
| `/mcp/guide` | GET | Global MCP guide + client configs | None |
| `/mcp/{agent_key}` | POST | Per-agent MCP (specific Agent tools only) | Bearer (optional) |
| `/mcp/{agent_key}/guide` | GET | Per-agent guide + client configs | None |

### 5-2. MCP JSON-RPC message format

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "method-name",
  "params": {}
}
```

### 5-3. Step 1 — initialize (handshake)

MCP clients must call `initialize` on first connection.

```bash
curl -X POST http://localhost:8001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-11-05",
    "capabilities": {
      "tools": {},
      "resources": {},
      "prompts": {}
    },
    "serverInfo": {
      "name": "secuardian",
      "version": "1.0.0"
    }
  }
}
```

### 5-4. Step 2 — tools/list

```bash
# Global endpoint — all active Addon + base Agent tools
curl -X POST http://localhost:8001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# Per-agent endpoint — example Agent tools only
curl -X POST http://localhost:8001/mcp/example \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "get_current_time",
        "description": "Get the current time",
        "inputSchema": {
          "type": "object",
          "properties": {
            "timezone": {
              "type": "string",
              "description": "Timezone (e.g. Asia/Seoul)"
            }
          }
        }
      }
    ]
  }
}
```

### 5-5. Step 3 — tools/call

```bash
curl -X POST http://localhost:8001/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "get_current_time",
      "arguments": {
        "timezone": "Asia/Seoul"
      }
    }
  }'
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"current_time\": \"2026-06-26T15:42:00+09:00\"}"
      }
    ]
  }
}
```

### 5-6. resources/list + resources/read

```bash
# List resources
curl -X POST http://localhost:8001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"resources/list","params":{}}'
# {"result": {"resources": [{"uri": "domain://context", "name": "Domain Context", "mimeType": "text/plain"}]}}

# Read a resource
curl -X POST http://localhost:8001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":5,"method":"resources/read","params":{"uri":"domain://context"}}'
```

### 5-7. prompts/list + prompts/get

```bash
# List prompts
curl -X POST http://localhost:8001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":6,"method":"prompts/list","params":{}}'
# {"result": {"prompts": [{"name": "system", "description": "Agent system prompt"}]}}

# Get system prompt
curl -X POST http://localhost:8001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":7,"method":"prompts/get","params":{"name":"system"}}'
```

### 5-8. MCP guide endpoints (auto-generates config snippets)

```bash
# Global guide — MCP URL, active tool list, client configs
curl http://localhost:8001/mcp/guide

# Per-agent guide — includes auto-assigned proxy port
curl http://localhost:8001/mcp/example/guide
```

### 5-9. Register MCP Agent with Main System

```bash
# Register MCP Agent (protocol=mcp)
curl -X POST http://localhost:8000/api/agent-registry/ \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_key": "example",
    "agent_name": "Example MCP Agent",
    "protocol": "mcp",
    "agent_card_url": "",
    "mcp_endpoint": "http://localhost:8001/mcp",
    "auth_token": ""
  }'

# Register MCP config (proxy port + custom args)
curl -X PUT http://localhost:8000/api/mcp-configs/example \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"port": 20001, "extra_args": ["--header:x-api-key:token"]}'

# Check MCP status (green/orange/red)
curl http://localhost:8000/api/mcp-configs/example/status \
  -H "Authorization: Bearer $MAIN_TOKEN"
```

### 5-10. Python SDK Example

```python
import asyncio
import httpx

BASE = "http://localhost:8001"

async def call_mcp_tool(tool_name: str, arguments: dict) -> str:
    async with httpx.AsyncClient() as client:
        # initialize
        await client.post(f"{BASE}/mcp", json={
            "jsonrpc": "2.0", "id": 1,
            "method": "initialize", "params": {}
        })

        # tools/call
        r = await client.post(f"{BASE}/mcp", json={
            "jsonrpc": "2.0", "id": 2,
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments}
        })
        result = r.json()
        if "error" in result:
            raise RuntimeError(result["error"]["message"])
        return result["result"]["content"][0]["text"]

text = asyncio.run(call_mcp_tool("get_current_time", {"timezone": "Asia/Seoul"}))
print(text)
```

---

## 6. Client Integrations

### 6-1. Claude Desktop

`~/.config/claude/claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "example": {
      "type": "http",
      "url": "http://localhost:8001/mcp"
    }
  }
}
```

With authentication (using mcp-remote bridge):

```json
{
  "mcpServers": {
    "example": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:8001/mcp",
        "--header", "Authorization: Bearer YOUR_TOKEN"
      ]
    }
  }
}
```

### 6-2. Cursor

`.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "example": {
      "type": "http",
      "url": "http://localhost:8001/mcp"
    }
  }
}
```

### 6-3. VSCode Continue

`.continue/config.json` `mcp` section:

```json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "name": "example",
        "transport": {
          "type": "http",
          "url": "http://localhost:8001/mcp"
        }
      }
    ]
  }
}
```

---

## 7. Docker Build & Deployment

### 7-1. Build image

```bash
# Using Make target
make docker-standalone AGENT=Example

# Direct build
docker build -f standalone/Dockerfile.standalone \
  --build-arg AGENT_KEY=example \
  --build-arg AGENT_PORT=8001 \
  -t wise-agent-example:latest .
```

### 7-2. Run per environment

```bash
# local (SQLite, volume mount)
docker run -p 8001:8001 \
  -e AGENT_KEY=example \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -v $(pwd)/local.db:/app/local.db \
  wise-agent-example:latest

# dev / staging (PostgreSQL)
docker run -p 8001:8001 \
  -e ENV=dev \
  -e AGENT_KEY=example \
  -e AGENT_BASE_URL=http://dev-server:8001 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e DATABASE_URL=postgresql://app:pass@postgres:5432/app_db \
  wise-agent-example:latest

# prod (PostgreSQL + explicit MCP_HOST)
docker run -p 8001:8001 \
  -e ENV=prod \
  -e AGENT_KEY=example \
  -e AGENT_BASE_URL=https://agent.mycompany.com \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e DATABASE_URL=postgresql://app:pass@postgres:5432/app_db \
  -e MCP_HOST=agent.mycompany.com \
  wise-agent-example:latest
```

### 7-3. docker-compose integration example

```yaml
# docker-compose.override.yml
services:
  standalone-example:
    image: wise-agent-example:latest
    ports:
      - "${AGENT_PORT:-8001}:8001"
    environment:
      ENV: ${ENV:-local}
      AGENT_KEY: example
      AGENT_BASE_URL: http://localhost:8001
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      DATABASE_URL: ${DATABASE_URL}
      MCP_HOST: ${MCP_HOST:-}
    depends_on:
      - postgres
    restart: unless-stopped
```

---

## 8. Agent Customization

### 8-1. Changing AGENT_KEY

`AGENT_KEY` is used as the `name` field in the A2A AgentCard and MCP `serverInfo.name`.

```bash
AGENT_KEY=my-domain-agent uv run uvicorn standalone.standalone_app:app --port 8001
```

### 8-2. Replacing the Agent

Replace `app/agents/example_agent.py` with your domain agent, then run standalone:

```python
# app/agents/my_agent.py
from app.agents.base_agent import BaseAgent

class MyAgent(BaseAgent):
    def get_tools(self) -> list[dict]:
        return [
            {
                "name": "search_products",
                "description": "Search for products",
                "input_schema": {
                    "type": "object",
                    "properties": {"query": {"type": "string"}},
                    "required": ["query"],
                },
            }
        ]
```

Update the `ExampleAgent` import in `standalone/standalone_app.py` → `router_a2a.py` to `MyAgent`.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `/.well-known/agent-card.json` → 500 | ExampleAgent import failure | Run `uv sync`, then restart; check `PYTHONPATH` |
| A2A Task status = `failed` | LLM API key not set | Add `ANTHROPIC_API_KEY` to `.env.{ENV}` |
| MCP `tools/list` returns empty array | No active Addons | Activate an Addon agent and retry |
| MCP URL returns `172.x.x.x` | Container LAN IP auto-detection limit | Set `MCP_HOST=<host IP>` |
| `port 8001 already in use` | Stale process | `pkill -f "standalone_app"` |
| AgentCard `url` is `localhost` | `AGENT_BASE_URL` not set | Set public URL in `.env.{ENV}` |
| DB connection error (dev+) | PostgreSQL not running | Run `make up` or `docker compose up postgres -d` |

---

See also: [`.docs/guides/06-standalone.md`](../.docs/guides/06-standalone.md)
