"""A2A Protocol v1.0 endpoints — Hybrid/Standalone mode (F12).

Spec: https://a2a-protocol.org/latest/specification/
AGENT_EXPOSE_PROTOCOL=a2a,mcp 설정 시 main.py에서 포함.
"""
import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.core.config import settings
from app.core.deps import get_current_user

router = APIRouter(tags=["a2a"])

_tasks: dict[str, dict] = {}
_task_queues: dict[str, asyncio.Queue] = {}


def _build_agent_card() -> dict:
    return {
        "name": settings.agent_key or "secuardian",
        "description": "SeCuardian AI Agent",
        "url": settings.agent_base_url,
        "version": "1.0.0",
        "capabilities": {"streaming": True, "tools": True},
        "skills": [],
        "authentication": {"schemes": ["bearer"]},
    }


@router.get("/.well-known/agent-card.json")
async def get_agent_card():
    """A2A AgentCard — 인증 불필요."""
    return _build_agent_card()


@router.post("/a2a/tasks", status_code=201)
async def create_task(body: dict, user: dict = Depends(get_current_user)):
    """A2A Task 생성 → 백그라운드 처리."""
    task_id = str(uuid.uuid4())
    message_text = "".join(
        p.get("text", "")
        for p in body.get("message", {}).get("parts", [])
        if p.get("kind") == "text"
    )
    _tasks[task_id] = {
        "id": task_id,
        "status": "submitted",
        "artifacts": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    queue: asyncio.Queue = asyncio.Queue()
    _task_queues[task_id] = queue
    asyncio.create_task(_run_agent_task(task_id, message_text, user))
    return {"id": task_id, "status": "submitted"}


async def _run_agent_task(task_id: str, message: str, user: dict) -> None:
    queue = _task_queues[task_id]
    _tasks[task_id]["status"] = "working"
    await queue.put({"type": "status-update", "state": "working"})
    try:
        from app.agents.orchestrator import Orchestrator
        full_text = ""
        async for sse in Orchestrator().stream(message, []):
            if sse.startswith("event: delta"):
                import json as _json
                data = sse.split("data: ", 1)[-1].strip()
                chunk = _json.loads(data).get("text", "")
                full_text += chunk
                await queue.put({
                    "type": "artifact-update",
                    "parts": [{"kind": "text", "text": chunk}],
                })
        _tasks[task_id].update({
            "status": "completed",
            "artifacts": [{"parts": [{"kind": "text", "text": full_text}]}],
        })
        await queue.put({"type": "status-update", "state": "completed"})
    except Exception as exc:
        _tasks[task_id].update({"status": "failed", "error": str(exc)})
        await queue.put({"type": "status-update", "state": "failed"})
    finally:
        await queue.put(None)


@router.get("/a2a/tasks/{task_id}")
async def stream_task(task_id: str, _: dict = Depends(get_current_user)):
    """A2A Task SSE 스트림 — status-update / artifact-update 이벤트."""
    if task_id not in _tasks:
        raise HTTPException(404, "Task not found")

    queue = _task_queues.get(task_id)

    async def _gen() -> AsyncGenerator[str, None]:
        if queue is None:
            state = _tasks[task_id]["status"]
            yield f"event: status-update\ndata: {json.dumps({'state': state})}\n\n"
            return
        while True:
            event = await asyncio.wait_for(queue.get(), timeout=60.0)
            if event is None:
                break
            etype = event.pop("type")
            yield f"event: {etype}\ndata: {json.dumps(event)}\n\n"

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/a2a/tasks/{task_id}/result")
async def get_task_result(task_id: str, _: dict = Depends(get_current_user)):
    """A2A Task 최종 결과."""
    if task_id not in _tasks:
        raise HTTPException(404, "Task not found")
    return _tasks[task_id]
