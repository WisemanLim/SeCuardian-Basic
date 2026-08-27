"""UserManager Agent — tbl_addon_user CRUD API 라우터.

파일명 규칙: {AgentName}-app.py  →  export: router (FastAPI APIRouter)
마운트 경로: /api/addon/usermanager/users/...

기능:
  GET    /users              사용자 목록 (검색/페이지네이션)
  POST   /users              사용자 추가
  PATCH  /users/{id}         사용자 수정 (이름/이메일/역할/상태/메모)
  DELETE /users/{id}         사용자 삭제 (soft-delete)
  POST   /users/{id}/reset-password  비밀번호 초기화 → 'changeme123'
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.addon_sdk import PH, execute_insert, execute_write, fetch_all, fetch_one, get_current_user

router = APIRouter(prefix="/users", tags=["usermanager"])

DEFAULT_PASSWORD = "changeme123"


# ─── Models ───────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    username: str
    full_name: Optional[str] = None
    email: Optional[str] = None
    role: str = "user"
    status: str = "active"
    password: str = DEFAULT_PASSWORD
    notes: Optional[str] = None


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _is_admin(user: dict) -> bool:
    return user.get("role") in ("admin", "supervisor", "superadmin")


VALID_ROLES    = {"admin", "user", "viewer", "manager"}
VALID_STATUSES = {"active", "inactive", "suspended"}


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("")
async def list_users(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    q: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    user: dict = Depends(get_current_user),
):
    conditions = ["NOT is_deleted"]
    params: list = []
    if q:
        conditions.append(f"(username LIKE {PH} OR full_name LIKE {PH} OR email LIKE {PH})")
        like = f"%{q}%"
        params += [like, like, like]
    if status:
        conditions.append(f"status = {PH}")
        params.append(status)

    where = " AND ".join(conditions)
    count_row = await fetch_one(f"SELECT COUNT(*) AS n FROM tbl_addon_user WHERE {where}", tuple(params))
    total = count_row["n"] if count_row else 0

    offset = (page - 1) * size
    rows = await fetch_all(
        f"SELECT id, username, full_name, email, role, status, notes, created_at, updated_at "
        f"FROM tbl_addon_user WHERE {where} ORDER BY created_at DESC LIMIT {PH} OFFSET {PH}",
        tuple(params) + (size, offset),
    )
    return {"total": total, "page": page, "size": size, "items": rows}


@router.post("", status_code=201)
async def create_user(
    body: UserCreate,
    user: dict = Depends(get_current_user),
):
    if not body.username.strip():
        raise HTTPException(status_code=400, detail="username은 필수입니다.")
    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"유효하지 않은 역할: {body.role}")
    if body.status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"유효하지 않은 상태: {body.status}")

    existing = await fetch_one(
        f"SELECT id FROM tbl_addon_user WHERE username = {PH} AND NOT is_deleted",
        (body.username.strip(),),
    )
    if existing:
        raise HTTPException(status_code=409, detail="이미 존재하는 username입니다.")

    new_id = await execute_insert(
        f"INSERT INTO tbl_addon_user (username, full_name, email, role, status, password, notes) "
        f"VALUES ({PH},{PH},{PH},{PH},{PH},{PH},{PH})",
        (body.username.strip(), body.full_name, body.email,
         body.role, body.status, body.password or DEFAULT_PASSWORD, body.notes),
    )
    row = await fetch_one(
        f"SELECT id, username, full_name, email, role, status, notes, created_at FROM tbl_addon_user WHERE id = {PH}",
        (new_id,),
    )
    return row


@router.patch("/{user_id}")
async def update_user(
    user_id: int,
    body: UserUpdate,
    user: dict = Depends(get_current_user),
):
    row = await fetch_one(
        f"SELECT id FROM tbl_addon_user WHERE id = {PH} AND NOT is_deleted", (user_id,)
    )
    if not row:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    if body.role and body.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"유효하지 않은 역할: {body.role}")
    if body.status and body.status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"유효하지 않은 상태: {body.status}")

    parts, params = [], []
    for field, val in [("full_name", body.full_name), ("email", body.email),
                        ("role", body.role), ("status", body.status), ("notes", body.notes)]:
        if val is not None:
            parts.append(f"{field} = {PH}")
            params.append(val)
    if not parts:
        raise HTTPException(status_code=400, detail="변경할 내용이 없습니다.")
    parts.append("updated_at = CURRENT_TIMESTAMP")
    params.append(user_id)
    await execute_write(
        f"UPDATE tbl_addon_user SET {', '.join(parts)} WHERE id = {PH}", tuple(params)
    )
    return await fetch_one(
        f"SELECT id, username, full_name, email, role, status, notes, created_at, updated_at "
        f"FROM tbl_addon_user WHERE id = {PH}", (user_id,)
    )


@router.delete("/{user_id}")
async def delete_user(
    user_id: int,
    user: dict = Depends(get_current_user),
):
    row = await fetch_one(
        f"SELECT id FROM tbl_addon_user WHERE id = {PH} AND NOT is_deleted", (user_id,)
    )
    if not row:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    await execute_write(
        f"UPDATE tbl_addon_user SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = {PH}",
        (user_id,),
    )
    return {"message": "사용자가 삭제되었습니다."}


@router.post("/{user_id}/reset-password")
async def reset_password(
    user_id: int,
    user: dict = Depends(get_current_user),
):
    row = await fetch_one(
        f"SELECT id, username FROM tbl_addon_user WHERE id = {PH} AND NOT is_deleted", (user_id,)
    )
    if not row:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    await execute_write(
        f"UPDATE tbl_addon_user SET password = {PH}, updated_at = CURRENT_TIMESTAMP WHERE id = {PH}",
        (DEFAULT_PASSWORD, user_id),
    )
    return {"message": f"'{row['username']}' 비밀번호가 초기화되었습니다.", "default_password": DEFAULT_PASSWORD}
