"""사용자별 대화이력 저장·조회 + 응답 만족도 피드백 (R18-2, R18-3).

- 세션은 (user_id, session_key) 단위 — session_key 는 프론트가 생성한 문자열 id.
- 사용자는 본인 이력만 접근, 피드백은 메시지당 사용자 1건 upsert.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.deps import get_current_user
from app.db import _PH, execute_insert, execute_write, fetch_all, fetch_one

router = APIRouter(prefix="/api/chat", tags=["chat-history"])

RATINGS = {"bad", "fine", "good"}


def _uid(user: dict) -> str:
    uid = user.get("sub")
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid token")
    return uid


async def _own_session(session_key: str, user_id: str) -> dict | None:
    return await fetch_one(
        f"SELECT * FROM tbl_chat_sessions WHERE user_id = {_PH} AND session_key = {_PH}",
        (user_id, session_key),
    )


@router.get("/sessions")
async def list_sessions(user: dict = Depends(get_current_user)):
    rows = await fetch_all(
        f"SELECT session_key, agent_key, title, model, created_at, updated_at "
        f"FROM tbl_chat_sessions WHERE user_id = {_PH} "
        f"ORDER BY COALESCE(updated_at, created_at) DESC",
        (_uid(user),),
    )
    return {"sessions": rows}


@router.get("/sessions/{session_key}/messages")
async def list_messages(session_key: str, user: dict = Depends(get_current_user)):
    session = await _own_session(session_key, _uid(user))
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    rows = await fetch_all(
        f"SELECT m.id, m.role, m.content, m.model, m.latency_ms, m.tokens_in, m.tokens_out, "
        f"m.created_at, f.rating "
        f"FROM tbl_chat_messages m "
        f"LEFT JOIN tbl_chat_feedback f ON f.message_id = m.id AND f.user_id = {_PH} "
        f"WHERE m.session_id = {_PH} ORDER BY m.id",
        (_uid(user), session["id"]),
    )
    return {"session": {k: session[k] for k in ("session_key", "title", "model", "agent_key")}, "messages": rows}


class ExchangeBody(BaseModel):
    """user 질문 + assistant 응답 1회 교환 저장 (세션 upsert)."""
    title: str | None = None
    model: str | None = None
    agent_key: str | None = None
    user_content: str
    assistant_content: str
    latency_ms: int | None = None
    tokens_in: int | None = None
    tokens_out: int | None = None
    assistant_model: str | None = None


@router.post("/sessions/{session_key}/exchange")
async def save_exchange(
    session_key: str,
    body: ExchangeBody,
    user: dict = Depends(get_current_user),
):
    uid = _uid(user)
    session = await _own_session(session_key, uid)
    if session:
        await execute_write(
            f"UPDATE tbl_chat_sessions SET model = COALESCE({_PH}, model), "
            f"updated_at = CURRENT_TIMESTAMP WHERE id = {_PH}",
            (body.model, session["id"]),
        )
        session_id = session["id"]
    else:
        session_id = await execute_insert(
            f"INSERT INTO tbl_chat_sessions (session_key, user_id, agent_key, title, model, updated_at) "
            f"VALUES ({_PH},{_PH},{_PH},{_PH},{_PH},CURRENT_TIMESTAMP)",
            (session_key, uid, body.agent_key, (body.title or body.user_content)[:200], body.model),
        )

    user_msg_id = await execute_insert(
        f"INSERT INTO tbl_chat_messages (session_id, role, content) VALUES ({_PH},{_PH},{_PH})",
        (session_id, "user", body.user_content),
    )
    assistant_msg_id = await execute_insert(
        f"INSERT INTO tbl_chat_messages (session_id, role, content, model, latency_ms, tokens_in, tokens_out) "
        f"VALUES ({_PH},{_PH},{_PH},{_PH},{_PH},{_PH},{_PH})",
        (session_id, "assistant", body.assistant_content, body.assistant_model,
         body.latency_ms, body.tokens_in, body.tokens_out),
    )
    return {
        "session_key": session_key,
        "user_message_id": user_msg_id,
        "assistant_message_id": assistant_msg_id,
    }


@router.delete("/sessions/{session_key}", status_code=204)
async def delete_session(session_key: str, user: dict = Depends(get_current_user)):
    session = await _own_session(session_key, _uid(user))
    if not session:
        return  # idempotent
    await execute_write(
        f"DELETE FROM tbl_chat_messages WHERE session_id = {_PH}", (session["id"],)
    )
    await execute_write(
        f"DELETE FROM tbl_chat_sessions WHERE id = {_PH}", (session["id"],)
    )


class FeedbackBody(BaseModel):
    rating: str = Field(pattern="^(bad|fine|good)$")


@router.put("/messages/{message_id}/feedback")
async def upsert_feedback(
    message_id: int,
    body: FeedbackBody,
    user: dict = Depends(get_current_user),
):
    uid = _uid(user)
    # 본인 세션의 assistant 메시지만 피드백 허용
    msg = await fetch_one(
        f"SELECT m.id, m.role FROM tbl_chat_messages m "
        f"JOIN tbl_chat_sessions s ON s.id = m.session_id "
        f"WHERE m.id = {_PH} AND s.user_id = {_PH}",
        (message_id, uid),
    )
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg["role"] != "assistant":
        raise HTTPException(status_code=400, detail="assistant 응답에만 피드백할 수 있습니다")

    existing = await fetch_one(
        f"SELECT id FROM tbl_chat_feedback WHERE message_id = {_PH} AND user_id = {_PH}",
        (message_id, uid),
    )
    if existing:
        await execute_write(
            f"UPDATE tbl_chat_feedback SET rating = {_PH}, updated_at = CURRENT_TIMESTAMP WHERE id = {_PH}",
            (body.rating, existing["id"]),
        )
    else:
        await execute_write(
            f"INSERT INTO tbl_chat_feedback (message_id, user_id, rating) VALUES ({_PH},{_PH},{_PH})",
            (message_id, uid, body.rating),
        )
    return {"message_id": message_id, "rating": body.rating}
