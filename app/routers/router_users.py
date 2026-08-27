"""사용자 관리 라우터 (F5 RBAC).

참조: SmartHaccp-MultiAgent app/routers/router_users.py
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.deps import require_role
from app.db import execute_write, fetch_all, fetch_one, _PH

router = APIRouter(prefix="/api/users", tags=["users"])


class UserCreate(BaseModel):
    user_id: str
    username: str
    password: str
    role: str = "user"
    email: str = ""


@router.get("/")
async def list_users(user: dict = Depends(require_role("supervisor", "admin"))):
    rows = await fetch_all(
        "SELECT serial, user_id, username, email, role, status, created_at FROM tbl_users ORDER BY serial"
    )
    return {"users": rows, "total": len(rows)}


@router.post("/", status_code=201)
async def create_user(
    body: UserCreate,
    user: dict = Depends(require_role("supervisor", "admin")),
):
    from app.core.security import hash_password
    existing = await fetch_one(
        f"SELECT user_id FROM tbl_users WHERE user_id = {_PH}", (body.user_id,)
    )
    if existing:
        raise HTTPException(status_code=409, detail="이미 존재하는 사용자 ID입니다")
    await execute_write(
        f"INSERT INTO tbl_users (user_id, username, email, password, role) VALUES ({_PH},{_PH},{_PH},{_PH},{_PH})",
        (body.user_id, body.username, body.email, hash_password(body.password), body.role),
    )
    return {"message": "사용자 생성 완료", "user_id": body.user_id}


@router.delete("/{user_id}")
async def delete_user(
    user_id: str,
    current: dict = Depends(require_role("supervisor")),
):
    if user_id == current.get("sub"):
        raise HTTPException(status_code=400, detail="본인 계정은 삭제할 수 없습니다")
    row = await fetch_one(f"SELECT user_id FROM tbl_users WHERE user_id = {_PH}", (user_id,))
    if not row:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    await execute_write(f"DELETE FROM tbl_users WHERE user_id = {_PH}", (user_id,))
    return {"message": "삭제 완료"}


# ── R18-5: 하위권한 사용자 상태 토글·비밀번호 초기화 ────────────────────────────
_ROLE_RANK = {"viewer": 0, "user": 1, "admin": 2, "supervisor": 3}


async def _require_lower_target(user_id: str, current: dict) -> dict:
    """본인·동급 이상 계정 제어 차단 — 하위권한 대상만 허용."""
    if user_id == current.get("sub"):
        raise HTTPException(status_code=400, detail="본인 계정은 여기서 제어할 수 없습니다")
    row = await fetch_one(
        f"SELECT user_id, role, status FROM tbl_users WHERE user_id = {_PH}", (user_id,)
    )
    if not row:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    if _ROLE_RANK.get(current.get("role"), 0) <= _ROLE_RANK.get(row["role"], 0):
        raise HTTPException(status_code=403, detail="하위 권한 사용자만 제어할 수 있습니다")
    return row


class StatusPatch(BaseModel):
    status: str  # active | inactive


@router.patch("/{user_id}/status")
async def patch_user_status(
    user_id: str,
    body: StatusPatch,
    current: dict = Depends(require_role("supervisor", "admin")),
):
    if body.status not in ("active", "inactive"):
        raise HTTPException(status_code=422, detail="status 는 active/inactive 만 허용")
    await _require_lower_target(user_id, current)
    await execute_write(
        f"UPDATE tbl_users SET status = {_PH}, updated_at = CURRENT_TIMESTAMP WHERE user_id = {_PH}",
        (body.status, user_id),
    )
    return {"user_id": user_id, "status": body.status}


@router.post("/{user_id}/reset-password")
async def reset_user_password(
    user_id: str,
    current: dict = Depends(require_role("supervisor", "admin")),
):
    """임시 비밀번호 발급 — 응답으로 1회만 노출, 저장은 해시."""
    import secrets

    from app.core.security import hash_password
    await _require_lower_target(user_id, current)
    temp_password = secrets.token_urlsafe(9)
    await execute_write(
        f"UPDATE tbl_users SET password = {_PH}, updated_at = CURRENT_TIMESTAMP WHERE user_id = {_PH}",
        (hash_password(temp_password), user_id),
    )
    return {"user_id": user_id, "temp_password": temp_password}
