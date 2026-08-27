"""ToolProxyAgent — 외부 REST API를 MCP Tool로 변환하는 어댑터 Agent.

마운트 경로: /api/addon/toolproxyagent/...
엔드포인트:
  GET  /tools              지원 도구 목록
  POST /tools/{tool_name}  도구 실행
  GET  /config             현재 연결 설정 조회 (credential 마스킹)
  PUT  /config             연결 설정 업데이트
"""
import json
import os
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.addon_sdk import get_current_user, require_role

router = APIRouter(tags=["tool-proxy-agent"])


# ─── 설정 (환경변수 또는 DB 기반으로 커스터마이즈) ────────────────────────────────

def _get_base_url() -> str:
    """[CUSTOMIZE] 연동할 외부 API의 베이스 URL."""
    return os.getenv("TOOL_PROXY_BASE_URL", "https://api.example.com")


def _get_auth_header() -> dict:
    """[CUSTOMIZE] 외부 API 인증 헤더."""
    token = os.getenv("TOOL_PROXY_API_KEY", "")
    return {"Authorization": f"Bearer {token}"} if token else {}


# ─── 도구 목록 정의 (커스터마이즈 대상) ────────────────────────────────────────

_TOOLS = [
    {
        "name": "example_get",
        "description": "외부 API에서 데이터를 조회합니다",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "API 경로 (예: /items/1)"}
            },
            "required": ["path"]
        }
    },
    {
        "name": "example_post",
        "description": "외부 API에 데이터를 전송합니다",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "body": {"type": "object"}
            },
            "required": ["path", "body"]
        }
    },
]


# ─── 엔드포인트 ──────────────────────────────────────────────────────────────

@router.get("/tools")
async def list_tools(user: dict = Depends(get_current_user)):
    """지원 도구 목록과 입력 스키마를 반환합니다."""
    return {"tools": _TOOLS}


class ToolCallRequest(BaseModel):
    arguments: dict[str, Any]


@router.post("/tools/{tool_name}")
async def call_tool(
    tool_name: str,
    body: ToolCallRequest,
    user: dict = Depends(get_current_user),
):
    """도구를 실행하고 외부 API 응답을 반환합니다."""
    tool = next((t for t in _TOOLS if t["name"] == tool_name), None)
    if not tool:
        raise HTTPException(status_code=404, detail=f"Tool '{tool_name}' not found")

    base_url = _get_base_url()
    headers = _get_auth_header()

    # [CUSTOMIZE] 도구별 실제 API 호출 로직
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            if tool_name == "example_get":
                path = body.arguments.get("path", "/")
                resp = await client.get(f"{base_url}{path}", headers=headers)
                resp.raise_for_status()
                return {"result": resp.json(), "status_code": resp.status_code}
            elif tool_name == "example_post":
                path = body.arguments.get("path", "/")
                post_body = body.arguments.get("body", {})
                resp = await client.post(f"{base_url}{path}", json=post_body, headers=headers)
                resp.raise_for_status()
                return {"result": resp.json(), "status_code": resp.status_code}
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"외부 API 호출 실패: {str(e)}")

    return {"result": None, "error": "Unknown tool"}


@router.get("/config")
async def get_config(user: dict = Depends(require_role("supervisor", "admin"))):
    """연결 설정 조회 (credential 마스킹)."""
    return {
        "base_url": _get_base_url(),
        "api_key_set": bool(os.getenv("TOOL_PROXY_API_KEY")),
        "tools_count": len(_TOOLS),
    }
