"""Agent Registry — 외부 Standalone Agent 등록·관리 (F12 + F23 Registry v2).

F23 추가:
- agent_type, capabilities_json, lifecycle_state, health_score 지원
- POST /search — capability 기반 검색
- GET  /{key}/card — Agent Card 조회
- PUT  /{key}/card — Agent Card 업데이트
- POST /{key}/heartbeat — Heartbeat 갱신
- GET  /{key}/health — 실시간 헬스 상태
"""
import json
import time
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.deps import require_role
from app.db import execute_write, fetch_all, fetch_one, _PH

router = APIRouter(prefix="/api/agent-registry", tags=["agent-registry"])

_LEASE_TTL_MINUTES = 30
_VALID_LIFECYCLE = {"draft", "active", "quarantined", "retired"}


# ── Models ────────────────────────────────────────────────────────────────────

class RegistryCreate(BaseModel):
    agent_key: str
    agent_name: str
    protocol: str = "a2a"
    agent_card_url: str = ""
    mcp_endpoint: str = ""
    auth_token: str = ""
    agent_type: str = "service"
    capabilities_json: str = ""  # JSON array of capability objects


class AgentCardUpdate(BaseModel):
    agent_card_json: str  # full Agent Card JSON


class CapabilitySearch(BaseModel):
    capabilities: list[str] = []   # verb 목록 (OR 검색)
    domain_prefix: str = ""        # domain 시작 문자열 필터
    agent_type: str = ""           # 유형 필터
    lifecycle_state: str = "active"
    max_health_score_below: float | None = None  # 최소 health_score


# ── 유틸 ──────────────────────────────────────────────────────────────────────

def _make_agent_card(row: dict) -> dict:
    """DB 행에서 표준 Agent Card 딕셔너리 생성."""
    try:
        caps = json.loads(row.get("capabilities_json") or "[]")
    except Exception:
        caps = []
    endpoint_url = row.get("agent_card_url") or row.get("mcp_endpoint") or ""
    protocol = row.get("protocol", "a2a")
    return {
        "identity": {
            "agent_id": row["agent_key"],
            "name": row["agent_name"],
            "description": "",
        },
        "version": {"card_schema_version": "2.0.0"},
        "capabilities": caps,
        "endpoints": [
            {"protocol": protocol, "url": endpoint_url, "auth_mode": "jwt"}
        ] if endpoint_url else [],
        "security": {"data_classification": "internal"},
        "interaction": {"supports_sync": True, "supports_streaming": False},
        "governance": {"audit_level": "standard"},
    }


def _health_dot(row: dict) -> str:
    state = row.get("lifecycle_state", "active")
    score = float(row.get("health_score") or 1.0)
    if state == "quarantined" or state == "retired":
        return "red"
    if score < 0.5:
        return "red"
    if score < 0.85:
        return "orange"
    return "green"


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.get("/")
async def list_registry(user: dict = Depends(require_role("supervisor", "admin"))):
    rows = await fetch_all(
        "SELECT agent_key, agent_name, protocol, agent_card_url, mcp_endpoint, "
        "agent_type, lifecycle_state, health_score, last_heartbeat_at, "
        "is_active, last_seen_at, created_at FROM tbl_agent_registry ORDER BY agent_key"
    )
    for row in rows:
        row["health_dot"] = _health_dot(row)
    return {"agents": rows}


@router.post("/", status_code=201)
async def register_agent(
    body: RegistryCreate,
    user: dict = Depends(require_role("supervisor", "admin")),
):
    existing = await fetch_one(
        f"SELECT agent_key FROM tbl_agent_registry WHERE agent_key = {_PH}", (body.agent_key,)
    )
    if existing:
        raise HTTPException(409, "Agent key already registered")

    caps_json = body.capabilities_json or "[]"
    # lease_expires_at = now + TTL
    expires = (datetime.now(timezone.utc) + timedelta(minutes=_LEASE_TTL_MINUTES)).isoformat()

    await execute_write(
        f"INSERT INTO tbl_agent_registry "
        f"(agent_key, agent_name, protocol, agent_card_url, mcp_endpoint, auth_token, "
        f"agent_type, capabilities_json, lifecycle_state, lease_expires_at, created_by) "
        f"VALUES ({_PH},{_PH},{_PH},{_PH},{_PH},{_PH},{_PH},{_PH},'active',{_PH},{_PH})",
        (
            body.agent_key, body.agent_name, body.protocol,
            body.agent_card_url, body.mcp_endpoint, body.auth_token,
            body.agent_type, caps_json, expires,
            user.get("user_id", ""),
        ),
    )
    return {"message": "Registered", "agent_key": body.agent_key}


@router.delete("/{agent_key}")
async def deregister_agent(
    agent_key: str,
    user: dict = Depends(require_role("supervisor", "admin")),
):
    row = await fetch_one(
        f"SELECT agent_key FROM tbl_agent_registry WHERE agent_key = {_PH}", (agent_key,)
    )
    if not row:
        raise HTTPException(404, "Not found")
    await execute_write(
        f"DELETE FROM tbl_agent_registry WHERE agent_key = {_PH}", (agent_key,)
    )
    return {"message": "Removed", "agent_key": agent_key}


@router.post("/{agent_key}/ping")
async def ping_agent(
    agent_key: str,
    user: dict = Depends(require_role("supervisor", "admin")),
):
    row = await fetch_one(
        f"SELECT agent_card_url, mcp_endpoint, auth_token FROM tbl_agent_registry "
        f"WHERE agent_key = {_PH}",
        (agent_key,),
    )
    if not row:
        raise HTTPException(404, "Not found")

    target_url = row.get("agent_card_url") or row.get("mcp_endpoint") or ""
    if not target_url:
        return {"ok": False, "latency_ms": 0, "error": "No URL configured"}

    start = time.monotonic()
    headers = {}
    if row.get("auth_token"):
        headers["Authorization"] = f"Bearer {row['auth_token']}"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(target_url, headers=headers)
        latency_ms = int((time.monotonic() - start) * 1000)
        ok = resp.status_code < 400
        if ok:
            await execute_write(
                f"UPDATE tbl_agent_registry SET last_seen_at = CURRENT_TIMESTAMP "
                f"WHERE agent_key = {_PH}",
                (agent_key,),
            )
        return {"ok": ok, "latency_ms": latency_ms, "status_code": resp.status_code}
    except Exception as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        return {"ok": False, "latency_ms": latency_ms, "error": str(exc)}


# ── F23 신규 API ──────────────────────────────────────────────────────────────

@router.post("/search")
async def search_agents(
    body: CapabilitySearch,
    user: dict = Depends(require_role("supervisor", "admin")),
):
    """capability verb / domain_prefix / agent_type 기반 Agent 검색."""
    rows = await fetch_all(
        "SELECT agent_key, agent_name, protocol, agent_card_url, mcp_endpoint, "
        "agent_type, capabilities_json, lifecycle_state, health_score, last_seen_at "
        "FROM tbl_agent_registry WHERE is_active = 1"
    )

    results = []
    for row in rows:
        # lifecycle_state 필터
        if body.lifecycle_state and row.get("lifecycle_state") != body.lifecycle_state:
            continue
        # agent_type 필터
        if body.agent_type and row.get("agent_type") != body.agent_type:
            continue
        # health_score 필터
        if body.max_health_score_below is not None:
            if float(row.get("health_score") or 1.0) > body.max_health_score_below:
                continue

        # capability verb 검색
        if body.capabilities or body.domain_prefix:
            try:
                caps = json.loads(row.get("capabilities_json") or "[]")
            except Exception:
                caps = []
            matched = False
            for cap in caps:
                verb_match = not body.capabilities or cap.get("verb") in body.capabilities
                domain_match = not body.domain_prefix or str(cap.get("domain", "")).startswith(body.domain_prefix)
                if verb_match and domain_match:
                    matched = True
                    break
            if not matched:
                continue

        row["health_dot"] = _health_dot(row)
        results.append(row)

    return {"total": len(results), "agents": results}


@router.get("/{agent_key}/card")
async def get_agent_card(
    agent_key: str,
    user: dict = Depends(require_role("supervisor", "admin")),
):
    """Agent Card 조회 — 저장된 JSON 또는 자동 생성."""
    row = await fetch_one(
        f"SELECT * FROM tbl_agent_registry WHERE agent_key = {_PH}", (agent_key,)
    )
    if not row:
        raise HTTPException(404, "Not found")

    if row.get("agent_card_json"):
        try:
            return json.loads(row["agent_card_json"])
        except Exception:
            pass
    return _make_agent_card(row)


@router.put("/{agent_key}/card")
async def update_agent_card(
    agent_key: str,
    body: AgentCardUpdate,
    user: dict = Depends(require_role("supervisor", "admin")),
):
    """Agent Card JSON 직접 업데이트."""
    row = await fetch_one(
        f"SELECT agent_key FROM tbl_agent_registry WHERE agent_key = {_PH}", (agent_key,)
    )
    if not row:
        raise HTTPException(404, "Not found")
    try:
        json.loads(body.agent_card_json)  # 유효 JSON 검증
    except Exception:
        raise HTTPException(400, "Invalid JSON")
    await execute_write(
        f"UPDATE tbl_agent_registry SET agent_card_json = {_PH} WHERE agent_key = {_PH}",
        (body.agent_card_json, agent_key),
    )
    return {"message": "Agent Card updated", "agent_key": agent_key}


@router.post("/{agent_key}/heartbeat")
async def heartbeat(
    agent_key: str,
    user: dict = Depends(require_role("supervisor", "admin")),
):
    """Heartbeat 갱신 — lease_expires_at 연장 + last_heartbeat_at 갱신."""
    row = await fetch_one(
        f"SELECT agent_key, lifecycle_state FROM tbl_agent_registry WHERE agent_key = {_PH}",
        (agent_key,),
    )
    if not row:
        raise HTTPException(404, "Not found")

    # quarantined → active 복구 (heartbeat 수신 시)
    new_state = "active" if row.get("lifecycle_state") == "quarantined" else row["lifecycle_state"]
    expires = (datetime.now(timezone.utc) + timedelta(minutes=_LEASE_TTL_MINUTES)).isoformat()

    await execute_write(
        f"UPDATE tbl_agent_registry SET "
        f"last_heartbeat_at = CURRENT_TIMESTAMP, last_seen_at = CURRENT_TIMESTAMP, "
        f"lease_expires_at = {_PH}, lifecycle_state = {_PH}, health_score = 1.0 "
        f"WHERE agent_key = {_PH}",
        (expires, new_state, agent_key),
    )
    return {
        "agent_key": agent_key,
        "lifecycle_state": new_state,
        "lease_expires_at": expires,
    }


@router.get("/{agent_key}/health")
async def get_health(
    agent_key: str,
    user: dict = Depends(require_role("supervisor", "admin")),
):
    """실시간 헬스 상태 조회 — health_dot + lifecycle_state + lease 만료 여부."""
    row = await fetch_one(
        f"SELECT agent_key, agent_name, lifecycle_state, health_score, "
        f"last_heartbeat_at, lease_expires_at, last_seen_at "
        f"FROM tbl_agent_registry WHERE agent_key = {_PH}",
        (agent_key,),
    )
    if not row:
        raise HTTPException(404, "Not found")

    # lease 만료 여부 계산
    lease_expired = False
    if row.get("lease_expires_at"):
        try:
            exp = datetime.fromisoformat(str(row["lease_expires_at"]))
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            lease_expired = exp < datetime.now(timezone.utc)
        except Exception:
            pass

    return {
        "agent_key": agent_key,
        "agent_name": row["agent_name"],
        "lifecycle_state": row["lifecycle_state"],
        "health_score": float(row["health_score"] or 1.0),
        "health_dot": _health_dot(row),
        "last_heartbeat_at": row.get("last_heartbeat_at"),
        "lease_expires_at": row.get("lease_expires_at"),
        "lease_expired": lease_expired,
        "last_seen_at": row.get("last_seen_at"),
    }
