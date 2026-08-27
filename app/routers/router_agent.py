"""AI 채팅 라우터 — SSE 스트리밍 (F1, F7).

참조: SmartHaccp-MultiAgent app/routers/router_chat.py
"""
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.agents.orchestrator import Orchestrator
from app.core.security import verify_token

router = APIRouter(prefix="/api/agent", tags=["agent"])
_bearer = HTTPBearer(auto_error=False)


def _get_user_id(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> str | None:
    if not creds:
        return None
    try:
        return verify_token(creds.credentials).get("sub")
    except Exception:
        return None


def _get_token(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> str | None:
    return creds.credentials if creds else None


class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []
    model: str | None = None
    agent_key: str | None = None  # addon 채팅 페이지 컨텍스트 — 기능안내 공통룰 대상 지정


@router.post("/chat")
async def chat(
    req: ChatRequest,
    user_id: str | None = Depends(_get_user_id),
    token: str | None = Depends(_get_token),
):
    orch = Orchestrator()
    result = await orch.run(
        req.message, req.history, req.model,
        user_id=user_id, token=token, agent_key=req.agent_key,
    )
    return {"response": result}


@router.post("/chat/stream")
async def chat_stream(
    req: ChatRequest,
    user_id: str | None = Depends(_get_user_id),
    token: str | None = Depends(_get_token),
):
    orch = Orchestrator()

    async def _gen():
        async for chunk in orch.stream(
            req.message, req.history, req.model,
            user_id=user_id, token=token, agent_key=req.agent_key,
        ):
            yield chunk

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
