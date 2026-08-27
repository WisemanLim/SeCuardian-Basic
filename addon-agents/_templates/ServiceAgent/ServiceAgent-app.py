"""ServiceAgent — 백엔드 비즈니스 로직 전용 Agent.

마운트 경로: /api/addon/serviceagent/...
엔드포인트:
  POST /invoke        동기 실행
  POST /invoke/stream SSE 스트리밍 실행
  GET  /status/{id}   비동기 작업 상태
  GET  /result/{id}   비동기 작업 결과
"""
import asyncio
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.addon_sdk import PH, execute_insert, execute_write, fetch_one, get_current_user

router = APIRouter(tags=["service-agent"])


class InvokeRequest(BaseModel):
    input: dict[str, Any]
    async_mode: bool = False


# ─── 동기 실행 ──────────────────────────────────────────────────────────────

@router.post("/invoke", status_code=200)
async def invoke(
    body: InvokeRequest,
    user: dict = Depends(get_current_user),
):
    """입력을 받아 비즈니스 로직을 동기 실행하고 결과를 반환합니다."""
    # [CUSTOMIZE] 여기에 비즈니스 로직 구현
    result = await _process(body.input)
    return {"output": result, "status": "completed"}


# ─── SSE 스트리밍 실행 ────────────────────────────────────────────────────────

@router.post("/invoke/stream")
async def invoke_stream(
    body: InvokeRequest,
    user: dict = Depends(get_current_user),
):
    """SSE로 처리 진행 상황과 최종 결과를 스트리밍합니다."""
    async def _gen():
        yield "data: {\"event\": \"start\"}\n\n"
        # [CUSTOMIZE] 스트리밍 처리 로직 구현
        result = await _process(body.input)
        import json
        yield f"data: {json.dumps({'event': 'result', 'output': result})}\n\n"
        yield "data: {\"event\": \"done\"}\n\n"

    return StreamingResponse(_gen(), media_type="text/event-stream")


# ─── 내부 처리 함수 (커스터마이즈 대상) ────────────────────────────────────────

async def _process(input_data: dict) -> dict:
    """[CUSTOMIZE] 실제 비즈니스 로직을 여기에 구현하세요."""
    await asyncio.sleep(0)  # 비동기 placeholder
    return {"processed": True, "input": input_data, "message": "ServiceAgent 처리 완료"}
