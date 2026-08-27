# Standalone Agent 배포 가이드

> [English →](README.en.md) · **F12 — A2A Protocol v1.0 + MCP JSON-RPC 2.0**

Agent를 독립 FastAPI 서비스로 패키징하여 A2A / MCP 프로토콜로 외부에 노출합니다.

---

## 목차

1. [구동 모드](#1-구동-모드)
2. [환경별 동작 (.env)](#2-환경별-동작-env)
3. [실행](#3-실행)
4. [A2A 등록 및 호출 가이드](#4-a2a-등록-및-호출-가이드)
5. [MCP 등록 및 호출 가이드](#5-mcp-등록-및-호출-가이드)
6. [클라이언트 연동](#6-클라이언트-연동)
7. [Docker 빌드 및 배포](#7-docker-빌드-및-배포)
8. [Agent 커스터마이즈](#8-agent-커스터마이즈)
9. [트러블슈팅](#9-트러블슈팅)

---

## 1. 구동 모드

| 모드 | 설명 | 진입 방법 |
|------|------|----------|
| **Embedded** | Orchestrator 내부 호출 (기본) | 기본값 — 설정 불필요 |
| **Standalone** | 독립 FastAPI 앱 (`:8001`) | `AGENT_KEY=example uv run uvicorn standalone.standalone_app:app --port 8001` |
| **Hybrid** | 메인 앱 + A2A/MCP 동시 노출 | `AGENT_EXPOSE_PROTOCOL=a2a,mcp` 설정 후 `make dev-be` |

---

## 2. 환경별 동작 (.env)

### 환경 파일 매핑

`ENV` 환경변수 값에 따라 로드할 `.env` 파일이 결정됩니다.

| `ENV` 값 | 로드 파일 | DB | 용도 |
|----------|----------|----|------|
| `local` (기본) | `.env.local` | SQLite (`./local.db`) | 로컬 개발 |
| `dev` | `.env.dev` | PostgreSQL | 개발 서버 |
| `staging` | `.env.staging` | PostgreSQL | 스테이징 서버 |
| `prod` | `.env.prod` | PostgreSQL (HA) | 프로덕션 |

### env 파일 적용 우선순위

```
1. 쉘에서 이미 export된 환경변수 (최우선)
2. .env.{ENV} 파일 값
3. config.py 기본값 (최하위)
```

### 환경별 설정 파일 준비

```bash
# local — .env.example 복사 후 ANTHROPIC_API_KEY 입력
cp .env.example .env.local
vi .env.local

# dev
cp .env.example .env.dev
# DATABASE_URL, REDIS_URL, ANTHROPIC_API_KEY 등 수정

# staging / prod
cp .env.example .env.staging
cp .env.example .env.prod
```

### Standalone 전용 주요 환경변수

```dotenv
# ── Standalone Agent ──────────────────────────────────────
ENV=local                            # local | dev | staging | prod
AGENT_STANDALONE=true                # standalone_app.py가 자동 설정
AGENT_KEY=example                    # 에이전트 식별자 (AgentCard name)
AGENT_PORT=8001                      # 리슨 포트
AGENT_BASE_URL=http://localhost:8001 # AgentCard에 노출될 공개 URL
                                     # Docker/서버: https://agent.mycompany.com

# ── DB (환경별 달리 설정) ─────────────────────────────────
# local:
DATABASE_URL=sqlite:///./local.db

# dev/staging/prod:
DATABASE_URL=postgresql://app:app@postgres:5432/app_db

# ── MCP Host (Docker/NAT 환경) ────────────────────────────
# 컨테이너 안에서 LAN IP 자동 감지가 안 될 때 명시
MCP_HOST=192.168.1.100
```

---

## 3. 실행

### 3-1. local (SQLite, 기본)

```bash
# .env.local 이 자동 로드됨 (ENV 생략 = local)
AGENT_KEY=example \
  uv run uvicorn standalone.standalone_app:app --reload --port 8001
```

헬스체크:

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

### 3-2. dev (PostgreSQL Docker 서비스 필요)

```bash
# .env.dev 에 DATABASE_URL=postgresql://... 설정 후
ENV=dev AGENT_KEY=example AGENT_BASE_URL=http://dev-server:8001 \
  uv run uvicorn standalone.standalone_app:app --port 8001
```

### 3-3. staging / prod

```bash
# staging
ENV=staging AGENT_KEY=example AGENT_BASE_URL=https://agent-staging.mycompany.com \
  uv run uvicorn standalone.standalone_app:app --host 0.0.0.0 --port 8001

# prod (workers 수 = CPU 코어수 × 2 + 1 권장)
ENV=prod AGENT_KEY=example AGENT_BASE_URL=https://agent.mycompany.com \
  uv run uvicorn standalone.standalone_app:app --host 0.0.0.0 --port 8001 --workers 4
```

### 3-4. Make 타겟

```bash
# Standalone 패키징 (agent 파일 복사 + 스크립트 생성)
make standalone AGENT=Example

# Docker 이미지 빌드
make docker-standalone AGENT=Example
```

---

## 4. A2A 등록 및 호출 가이드

A2A(Agent-to-Agent) Protocol v1.0 기반입니다.

### 4-1. 엔드포인트 목록

| 경로 | 메서드 | 설명 | 인증 |
|------|--------|------|------|
| `/.well-known/agent-card.json` | GET | Agent 메타데이터 조회 (discovery) | 없음 |
| `/a2a/tasks` | POST | Task 생성 + 비동기 실행 | Bearer |
| `/a2a/tasks/{id}` | GET | Task SSE 스트림 구독 | Bearer |
| `/a2a/tasks/{id}/result` | GET | Task 최종 결과 조회 | Bearer |

### 4-2. Step 1 — AgentCard 조회 (Discovery)

외부 클라이언트 / Orchestrator가 Agent 능력을 탐색합니다.

```bash
curl http://localhost:8001/.well-known/agent-card.json
```

응답 예시:

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
      "name": "현재 시각 조회",
      "tags": []
    }
  ],
  "authentication": {
    "schemes": ["bearer"]
  }
}
```

### 4-3. Step 2 — JWT 토큰 발급

A2A Task 생성 및 조회에 Bearer 토큰이 필요합니다.

```bash
TOKEN=$(curl -s -X POST http://localhost:8001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"user_id":"admin","password":"Admin123!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

echo $TOKEN
```

### 4-4. Step 3 — Task 생성

```bash
TASK=$(curl -s -X POST http://localhost:8001/a2a/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "message": {
      "parts": [
        {"kind": "text", "text": "현재 시각을 알려주세요"}
      ]
    }
  }')

echo $TASK
# {"id": "550e8400-e29b-41d4-a716-446655440000", "status": "submitted"}

TASK_ID=$(echo $TASK | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
```

### 4-5. Step 4 — SSE 스트림 구독

Task 처리 중 실시간으로 상태 변화와 결과 청크를 수신합니다.

```bash
curl -N http://localhost:8001/a2a/tasks/$TASK_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: text/event-stream"
```

SSE 이벤트 스트림 예시:

```
event: status-update
data: {"state": "working"}

event: artifact-update
data: {"parts": [{"kind": "text", "text": "현재 시각은 "}]}

event: artifact-update
data: {"parts": [{"kind": "text", "text": "2026년 6월 26일 오후 3시 42분입니다."}]}

event: status-update
data: {"state": "completed"}
```

| 이벤트 | 의미 |
|--------|------|
| `status-update` → `submitted` | Task 큐 진입 |
| `status-update` → `working` | Agent 처리 중 |
| `artifact-update` | LLM 응답 청크 (스트리밍) |
| `status-update` → `completed` | 처리 완료 |
| `status-update` → `failed` | 처리 실패 |

### 4-6. Step 5 — 최종 결과 조회

스트림 완료 후 전체 결과를 한 번에 조회합니다.

```bash
curl http://localhost:8001/a2a/tasks/$TASK_ID/result \
  -H "Authorization: Bearer $TOKEN"
```

응답:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "artifacts": [
    {
      "parts": [
        {"kind": "text", "text": "현재 시각은 2026년 6월 26일 오후 3시 42분입니다."}
      ]
    }
  ],
  "created_at": "2026-06-26T06:42:00Z"
}
```

### 4-7. 메인 시스템에 A2A Agent 등록

Standalone Agent를 메인 Orchestrator가 라우팅할 수 있도록 Agent Registry에 등록합니다.

```bash
# 메인 시스템 토큰 발급
MAIN_TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"user_id":"admin","password":"Admin123!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Agent 등록 (protocol=a2a)
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

# 등록 확인
curl http://localhost:8000/api/agent-registry/ \
  -H "Authorization: Bearer $MAIN_TOKEN"

# 연결 테스트 (ping → agent card URL 헬스체크)
curl -X POST http://localhost:8000/api/agent-registry/example/ping \
  -H "Authorization: Bearer $MAIN_TOKEN"
# {"ok": true, "latency_ms": 12, "status_code": 200}

# 등록 해제
curl -X DELETE http://localhost:8000/api/agent-registry/example \
  -H "Authorization: Bearer $MAIN_TOKEN"
```

### 4-8. Python SDK 예시

```python
import asyncio
import httpx

BASE = "http://localhost:8001"

async def run_a2a_task(message: str) -> str:
    async with httpx.AsyncClient() as client:
        # 1. 토큰 발급
        r = await client.post(f"{BASE}/api/auth/login",
            json={"user_id": "admin", "password": "Admin123!"})
        token = r.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 2. Task 생성
        r = await client.post(f"{BASE}/a2a/tasks", headers=headers,
            json={"message": {"parts": [{"kind": "text", "text": message}]}})
        task_id = r.json()["id"]

        # 3. SSE 스트림 수신
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

result = asyncio.run(run_a2a_task("현재 시각을 알려주세요"))
print(result)
```

---

## 5. MCP 등록 및 호출 가이드

MCP(Model Context Protocol) JSON-RPC 2.0 Streamable HTTP 전송 방식입니다.

### 5-1. 엔드포인트 목록

| 경로 | 메서드 | 설명 | 인증 |
|------|--------|------|------|
| `/mcp` | POST | 통합 MCP (모든 활성 Addon tools) | Bearer (선택) |
| `/mcp/guide` | GET | 통합 MCP 가이드 + 클라이언트 설정 | 없음 |
| `/mcp/{agent_key}` | POST | Per-agent MCP (특정 Agent tools만) | Bearer (선택) |
| `/mcp/{agent_key}/guide` | GET | Per-agent 가이드 + 클라이언트 설정 | 없음 |

### 5-2. MCP JSON-RPC 메시지 구조

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "메서드명",
  "params": {}
}
```

### 5-3. Step 1 — initialize (핸드셰이크)

MCP 클라이언트는 첫 연결 시 반드시 `initialize`를 호출합니다.

```bash
curl -X POST http://localhost:8001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

응답:

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

### 5-4. Step 2 — tools/list (도구 목록 조회)

```bash
# 통합 엔드포인트 — 모든 활성 Addon + 기본 Agent 도구
curl -X POST http://localhost:8001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# Per-agent 엔드포인트 — example Agent 도구만
curl -X POST http://localhost:8001/mcp/example \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

응답:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "get_current_time",
        "description": "현재 시각을 조회합니다",
        "inputSchema": {
          "type": "object",
          "properties": {
            "timezone": {
              "type": "string",
              "description": "타임존 (예: Asia/Seoul)"
            }
          }
        }
      }
    ]
  }
}
```

### 5-5. Step 3 — tools/call (도구 호출)

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

응답:

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
# 리소스 목록
curl -X POST http://localhost:8001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"resources/list","params":{}}'
# {"result": {"resources": [{"uri": "domain://context", "name": "Domain Context", "mimeType": "text/plain"}]}}

# 리소스 읽기
curl -X POST http://localhost:8001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":5,"method":"resources/read","params":{"uri":"domain://context"}}'
```

### 5-7. prompts/list + prompts/get

```bash
# 프롬프트 목록
curl -X POST http://localhost:8001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":6,"method":"prompts/list","params":{}}'
# {"result": {"prompts": [{"name": "system", "description": "Agent system prompt"}]}}

# 시스템 프롬프트 조회
curl -X POST http://localhost:8001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":7,"method":"prompts/get","params":{"name":"system"}}'
```

### 5-8. MCP 가이드 엔드포인트 (자동 설정 스니펫 생성)

```bash
# 통합 가이드 — MCP URL, 활성 도구 목록, 클라이언트 설정 일괄 반환
curl http://localhost:8001/mcp/guide

# Per-agent 가이드 — proxy port 자동 할당 포함
curl http://localhost:8001/mcp/example/guide
```

### 5-9. 메인 시스템에 MCP Agent 등록

```bash
# MCP Agent 등록 (protocol=mcp)
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

# MCP Config 등록 (proxy port + 커스텀 인자)
curl -X PUT http://localhost:8000/api/mcp-configs/example \
  -H "Authorization: Bearer $MAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"port": 20001, "extra_args": ["--header:x-api-key:token"]}'

# MCP 상태 확인 (green/orange/red)
curl http://localhost:8000/api/mcp-configs/example/status \
  -H "Authorization: Bearer $MAIN_TOKEN"
```

### 5-10. Python SDK 예시

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

## 6. 클라이언트 연동

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

인증이 필요한 경우 (mcp-remote 브리지 사용):

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

`.continue/config.json` 의 `mcp` 섹션:

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

## 7. Docker 빌드 및 배포

### 7-1. 이미지 빌드

```bash
# Make 타겟 사용
make docker-standalone AGENT=Example

# 직접 빌드
docker build -f standalone/Dockerfile.standalone \
  --build-arg AGENT_KEY=example \
  --build-arg AGENT_PORT=8001 \
  -t wise-agent-example:latest .
```

### 7-2. 환경별 실행

```bash
# local (SQLite, 볼륨 마운트)
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

# prod (PostgreSQL + MCP_HOST 명시)
docker run -p 8001:8001 \
  -e ENV=prod \
  -e AGENT_KEY=example \
  -e AGENT_BASE_URL=https://agent.mycompany.com \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e DATABASE_URL=postgresql://app:pass@postgres:5432/app_db \
  -e MCP_HOST=agent.mycompany.com \
  wise-agent-example:latest
```

### 7-3. docker-compose 통합 예시

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

## 8. Agent 커스터마이즈

### 8-1. AGENT_KEY 변경

`AGENT_KEY` 는 A2A AgentCard의 `name` 필드와 MCP `serverInfo.name` 에 사용됩니다.

```bash
AGENT_KEY=my-domain-agent uv run uvicorn standalone.standalone_app:app --port 8001
```

### 8-2. 커스텀 Agent 교체

`app/agents/example_agent.py` 를 도메인 Agent로 교체한 후 standalone 실행:

```python
# app/agents/my_agent.py
from app.agents.base_agent import BaseAgent

class MyAgent(BaseAgent):
    def get_tools(self) -> list[dict]:
        return [
            {
                "name": "search_products",
                "description": "제품을 검색합니다",
                "input_schema": {
                    "type": "object",
                    "properties": {"query": {"type": "string"}},
                    "required": ["query"],
                },
            }
        ]
```

`standalone/standalone_app.py` 의 `router_a2a.py` → `ExampleAgent` import를 `MyAgent`로 교체.

---

## 9. 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| `/.well-known/agent-card.json` → 500 | ExampleAgent import 실패 | `uv sync` 후 재실행; `PYTHONPATH` 확인 |
| A2A Task status = `failed` | LLM API 키 미설정 | `.env.{ENV}` 에 `ANTHROPIC_API_KEY` 입력 |
| MCP `tools/list` → 빈 배열 | 활성 Addon 없음 | Addon 에이전트 활성화 후 재조회 |
| MCP URL이 `172.x.x.x` 로 반환 | Docker 컨테이너 내 IP 자동 감지 한계 | `MCP_HOST=<호스트 IP>` 설정 |
| `port 8001 already in use` | 이전 프로세스 잔류 | `pkill -f "standalone_app"` |
| AgentCard `url` 이 `localhost` | `AGENT_BASE_URL` 미설정 | `.env.{ENV}` 에 공개 URL 입력 |
| DB 연결 실패 (dev+) | PostgreSQL 미기동 | `make up` 또는 `docker compose up postgres -d` |

---

자세한 내용: [`.docs/guides/06-standalone.md`](../.docs/guides/06-standalone.md)
