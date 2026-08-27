"""관리자(운영자) 건의전달 API (R18-4) — 1차: DB 저장까지."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.core.deps import get_current_user, require_role
from app.db import _PH, execute_insert, fetch_all

router = APIRouter(prefix="/api/suggestions", tags=["suggestions"])


class SuggestionBody(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1)


@router.post("", status_code=201)
async def create_suggestion(body: SuggestionBody, user: dict = Depends(get_current_user)):
    sid = await execute_insert(
        f"INSERT INTO tbl_suggestions (user_id, title, content) VALUES ({_PH},{_PH},{_PH})",
        (user.get("sub"), body.title, body.content),
    )
    return {"id": sid, "status": "new"}


@router.get("")
async def list_suggestions(user: dict = Depends(require_role("supervisor", "admin"))):
    """관리자 열람 — 차후 통계/처리 화면에서 사용."""
    rows = await fetch_all(
        "SELECT id, user_id, title, content, status, created_at FROM tbl_suggestions ORDER BY id DESC"
    )
    return {"suggestions": rows}
