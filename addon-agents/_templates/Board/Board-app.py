"""Board Agent — 게시판 API 라우터.

파일명 규칙: {AgentName}-app.py  →  export: router (FastAPI APIRouter)
마운트 경로: /api/addon/board/posts/...  (addon_agent_loader 가 prefix 결정)

기능:
  GET    /posts              게시글 목록 (페이지네이션)
  POST   /posts              게시글 작성
  GET    /posts/{id}         게시글 상세 + 댓글 목록
  PATCH  /posts/{id}         게시글 수정 (작성자 본인 or admin)
  DELETE /posts/{id}         게시글 삭제 (soft-delete)
  POST   /posts/{id}/comments  댓글 작성
  DELETE /posts/{id}/comments/{comment_id}  댓글 삭제 (soft-delete)
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.addon_sdk import PH, execute_insert, execute_write, fetch_all, fetch_one, get_current_user

router = APIRouter(prefix="/posts", tags=["board"])


# ─── Models ───────────────────────────────────────────────────────────────────

class PostCreate(BaseModel):
    title: str
    content: str


class PostUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None


class CommentCreate(BaseModel):
    content: str


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _is_admin(user: dict) -> bool:
    return user.get("role") in ("admin", "supervisor", "superadmin")


# ─── Posts ────────────────────────────────────────────────────────────────────

@router.get("")
async def list_posts(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    offset = (page - 1) * size
    count_row = await fetch_one(
        "SELECT COUNT(*) AS n FROM tbl_board_posts WHERE NOT is_deleted"
    )
    total = count_row["n"] if count_row else 0
    items = await fetch_all(
        f"SELECT id, title, author_id, author_name, created_at, updated_at "
        f"FROM tbl_board_posts WHERE NOT is_deleted ORDER BY created_at DESC "
        f"LIMIT {PH} OFFSET {PH}",
        (size, offset),
    )
    return {"total": total, "page": page, "size": size, "items": items}


@router.post("", status_code=201)
async def create_post(
    body: PostCreate,
    user: dict = Depends(get_current_user),
):
    if not body.title.strip() or not body.content.strip():
        raise HTTPException(status_code=400, detail="제목과 내용을 입력하세요.")
    author_id = user.get("sub") or user.get("user_id", "unknown")
    author_name = user.get("username") or author_id
    post_id = await execute_insert(
        f"INSERT INTO tbl_board_posts (title, content, author_id, author_name) "
        f"VALUES ({PH},{PH},{PH},{PH})",
        (body.title.strip(), body.content.strip(), author_id, author_name),
    )
    return await fetch_one(
        f"SELECT * FROM tbl_board_posts WHERE id = {PH}", (post_id,)
    )


@router.get("/{post_id}")
async def get_post(
    post_id: int,
    user: dict = Depends(get_current_user),
):
    post = await fetch_one(
        f"SELECT * FROM tbl_board_posts WHERE id = {PH} AND NOT is_deleted",
        (post_id,),
    )
    if not post:
        raise HTTPException(status_code=404, detail="게시글을 찾을 수 없습니다.")
    comments = await fetch_all(
        f"SELECT id, content, author_id, author_name, created_at "
        f"FROM tbl_board_comments WHERE post_id = {PH} AND NOT is_deleted ORDER BY created_at",
        (post_id,),
    )
    return {**post, "comments": comments}


@router.patch("/{post_id}")
async def update_post(
    post_id: int,
    body: PostUpdate,
    user: dict = Depends(get_current_user),
):
    post = await fetch_one(
        f"SELECT * FROM tbl_board_posts WHERE id = {PH} AND NOT is_deleted", (post_id,)
    )
    if not post:
        raise HTTPException(status_code=404, detail="게시글을 찾을 수 없습니다.")
    author_id = user.get("sub") or user.get("user_id", "")
    if post["author_id"] != author_id and not _is_admin(user):
        raise HTTPException(status_code=403, detail="수정 권한이 없습니다.")

    parts, params = [], []
    if body.title is not None:
        parts.append(f"title = {PH}"); params.append(body.title.strip())
    if body.content is not None:
        parts.append(f"content = {PH}"); params.append(body.content.strip())
    if not parts:
        raise HTTPException(status_code=400, detail="변경할 내용이 없습니다.")
    parts.append("updated_at = CURRENT_TIMESTAMP")
    params.append(post_id)
    await execute_write(
        f"UPDATE tbl_board_posts SET {', '.join(parts)} WHERE id = {PH}", tuple(params)
    )
    return await fetch_one(
        f"SELECT * FROM tbl_board_posts WHERE id = {PH}", (post_id,)
    )


@router.delete("/{post_id}")
async def delete_post(
    post_id: int,
    user: dict = Depends(get_current_user),
):
    post = await fetch_one(
        f"SELECT * FROM tbl_board_posts WHERE id = {PH} AND NOT is_deleted", (post_id,)
    )
    if not post:
        raise HTTPException(status_code=404, detail="게시글을 찾을 수 없습니다.")
    author_id = user.get("sub") or user.get("user_id", "")
    if post["author_id"] != author_id and not _is_admin(user):
        raise HTTPException(status_code=403, detail="삭제 권한이 없습니다.")
    await execute_write(
        f"UPDATE tbl_board_posts SET is_deleted = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = {PH}",
        (post_id,),
    )
    return {"message": "게시글이 삭제되었습니다."}


# ─── Comments ─────────────────────────────────────────────────────────────────

@router.post("/{post_id}/comments", status_code=201)
async def create_comment(
    post_id: int,
    body: CommentCreate,
    user: dict = Depends(get_current_user),
):
    post = await fetch_one(
        f"SELECT id FROM tbl_board_posts WHERE id = {PH} AND NOT is_deleted", (post_id,)
    )
    if not post:
        raise HTTPException(status_code=404, detail="게시글을 찾을 수 없습니다.")
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="댓글 내용을 입력하세요.")
    author_id = user.get("sub") or user.get("user_id", "unknown")
    author_name = user.get("username") or author_id
    comment_id = await execute_insert(
        f"INSERT INTO tbl_board_comments (post_id, content, author_id, author_name) "
        f"VALUES ({PH},{PH},{PH},{PH})",
        (post_id, body.content.strip(), author_id, author_name),
    )
    return await fetch_one(
        f"SELECT * FROM tbl_board_comments WHERE id = {PH}", (comment_id,)
    )


@router.delete("/{post_id}/comments/{comment_id}")
async def delete_comment(
    post_id: int,
    comment_id: int,
    user: dict = Depends(get_current_user),
):
    comment = await fetch_one(
        f"SELECT * FROM tbl_board_comments WHERE id = {PH} AND post_id = {PH} AND NOT is_deleted",
        (comment_id, post_id),
    )
    if not comment:
        raise HTTPException(status_code=404, detail="댓글을 찾을 수 없습니다.")
    author_id = user.get("sub") or user.get("user_id", "")
    if comment["author_id"] != author_id and not _is_admin(user):
        raise HTTPException(status_code=403, detail="삭제 권한이 없습니다.")
    await execute_write(
        f"UPDATE tbl_board_comments SET is_deleted = TRUE WHERE id = {PH}", (comment_id,)
    )
    return {"message": "댓글이 삭제되었습니다."}
