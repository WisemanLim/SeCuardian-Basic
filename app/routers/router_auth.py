"""인증 라우터 — JWT 로그인·로그아웃·TOTP 2FA (F5).

참조: SmartHaccp-MultiAgent app/routers/router_auth.py
"""
import pyotp
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.core.security import (
    create_access_token,
    hash_password,
    revoke_token,
    verify_password,
    verify_token,
)
from app.db import execute_write, fetch_one, _PH

router = APIRouter(prefix="/api/auth", tags=["auth"])

_ISSUER = "SeCuardian"


# ── 모델 ──────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    user_id: str
    password: str
    totp: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    username: str
    totp_enabled: bool = False


class ProfileUpdate(BaseModel):
    username: str | None = None
    email: str | None = None
    password: str | None = None
    custom_instructions: str | None = None
    preferred_lang: str | None = None  # R18-7: 선호언어 (ko/en, 확장 가능)


class TotpCodeRequest(BaseModel):
    code: str


# ── 로그인 / 로그아웃 ──────────────────────────────────────────────────────────

@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest):
    user = await fetch_one(
        f"SELECT user_id, username, password, role, status, totp_secret, totp_enabled "
        f"FROM tbl_users WHERE user_id = {_PH}",
        (req.user_id,),
    )
    if not user or not verify_password(req.password, user["password"]):
        raise HTTPException(status_code=401, detail="아이디 또는 비밀번호가 올바르지 않습니다")
    if user.get("status") != "active":
        raise HTTPException(status_code=403, detail="비활성화된 계정입니다")

    # TOTP gate
    if user.get("totp_enabled"):
        if not req.totp:
            raise HTTPException(status_code=401, detail="totp_required")
        if not pyotp.TOTP(user["totp_secret"]).verify(req.totp, valid_window=1):
            raise HTTPException(status_code=401, detail="TOTP 코드가 올바르지 않습니다")

    username = user.get("username") or user["user_id"]
    token = create_access_token({
        "sub": user["user_id"],
        "role": user["role"],
        "username": username,
    })
    return TokenResponse(
        access_token=token,
        role=user["role"],
        username=username,
        totp_enabled=bool(user.get("totp_enabled")),
    )


@router.post("/logout")
async def logout(creds: HTTPAuthorizationCredentials = Depends(HTTPBearer())):
    revoke_token(creds.credentials)
    return {"message": "로그아웃 완료"}


# ── 프로필 ─────────────────────────────────────────────────────────────────────

@router.get("/me")
async def me(creds: HTTPAuthorizationCredentials = Depends(HTTPBearer())):
    payload = verify_token(creds.credentials)
    user_id = payload.get("sub")
    row = await fetch_one(
        f"SELECT user_id, username, email, role, totp_enabled, custom_instructions, preferred_lang, created_at "
        f"FROM tbl_users WHERE user_id = {_PH}",
        (user_id,),
    )
    if not row:
        raise HTTPException(status_code=404, detail="사용자 없음")
    row["totp_enabled"] = bool(row.get("totp_enabled"))
    return row


@router.patch("/me")
async def update_me(
    body: ProfileUpdate,
    creds: HTTPAuthorizationCredentials = Depends(HTTPBearer()),
):
    payload = verify_token(creds.credentials)
    user_id = payload.get("sub")

    sets: list[str] = []
    vals: list = []
    if body.username is not None:
        sets.append(f"username = {_PH}")
        vals.append(body.username)
    if body.email is not None:
        sets.append(f"email = {_PH}")
        vals.append(body.email)
    if body.password:
        sets.append(f"password = {_PH}")
        vals.append(hash_password(body.password))
    if body.custom_instructions is not None:
        sets.append(f"custom_instructions = {_PH}")
        vals.append(body.custom_instructions)
    if body.preferred_lang is not None:
        lang = body.preferred_lang.strip().lower()
        if lang and not lang.replace("-", "").isalpha():
            raise HTTPException(status_code=400, detail="preferred_lang 형식이 올바르지 않습니다")
        sets.append(f"preferred_lang = {_PH}")
        vals.append(lang or None)

    if not sets:
        return {"message": "변경 없음"}

    sets.append("updated_at = CURRENT_TIMESTAMP")
    vals.append(user_id)
    await execute_write(
        f"UPDATE tbl_users SET {', '.join(sets)} WHERE user_id = {_PH}",
        tuple(vals),
    )
    return {"message": "프로필 업데이트 완료"}


# ── TOTP / 2FA ─────────────────────────────────────────────────────────────────

@router.get("/totp/qr")
async def totp_qr(creds: HTTPAuthorizationCredentials = Depends(HTTPBearer())):
    """TOTP 시크릿 발급 + OTPAuth URI 반환 (QR 렌더링은 프론트에서)."""
    payload = verify_token(creds.credentials)
    user_id = payload.get("sub")

    row = await fetch_one(
        f"SELECT totp_secret, totp_enabled FROM tbl_users WHERE user_id = {_PH}",
        (user_id,),
    )
    if not row:
        raise HTTPException(status_code=404)

    secret = row.get("totp_secret")
    if not secret:
        secret = pyotp.random_base32()
        await execute_write(
            f"UPDATE tbl_users SET totp_secret = {_PH} WHERE user_id = {_PH}",
            (secret, user_id),
        )

    otpauth = pyotp.TOTP(secret).provisioning_uri(name=user_id, issuer_name=_ISSUER)
    return {"otpauth": otpauth, "enabled": bool(row.get("totp_enabled"))}


@router.post("/totp/enable")
async def totp_enable(
    body: TotpCodeRequest,
    creds: HTTPAuthorizationCredentials = Depends(HTTPBearer()),
):
    """6자리 코드 검증 후 TOTP 활성화."""
    payload = verify_token(creds.credentials)
    user_id = payload.get("sub")

    row = await fetch_one(
        f"SELECT totp_secret FROM tbl_users WHERE user_id = {_PH}", (user_id,)
    )
    if not row or not row.get("totp_secret"):
        raise HTTPException(status_code=400, detail="TOTP 시크릿이 없습니다. QR 코드를 먼저 조회하세요")

    if not pyotp.TOTP(row["totp_secret"]).verify(body.code, valid_window=1):
        raise HTTPException(status_code=400, detail="인증 코드가 올바르지 않습니다")

    await execute_write(
        f"UPDATE tbl_users SET totp_enabled = 1 WHERE user_id = {_PH}", (user_id,)
    )
    return {"enabled": True}


@router.post("/totp/disable")
async def totp_disable(
    body: TotpCodeRequest,
    creds: HTTPAuthorizationCredentials = Depends(HTTPBearer()),
):
    """6자리 코드 검증 후 TOTP 비활성화 + 시크릿 삭제."""
    payload = verify_token(creds.credentials)
    user_id = payload.get("sub")

    row = await fetch_one(
        f"SELECT totp_secret, totp_enabled FROM tbl_users WHERE user_id = {_PH}", (user_id,)
    )
    if not row or not row.get("totp_secret") or not row.get("totp_enabled"):
        raise HTTPException(status_code=400, detail="TOTP가 활성화되어 있지 않습니다")

    if not pyotp.TOTP(row["totp_secret"]).verify(body.code, valid_window=1):
        raise HTTPException(status_code=400, detail="인증 코드가 올바르지 않습니다")

    await execute_write(
        f"UPDATE tbl_users SET totp_enabled = 0, totp_secret = NULL WHERE user_id = {_PH}",
        (user_id,),
    )
    return {"enabled": False}
