"""JWT 인증 + 패스워드 해싱 (bcrypt).

참조: SmartHaccp-MultiAgent app/security.py
변경: SHA256 → bcrypt 직접 사용 (passlib 호환성 이슈 제거)
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt as _bcrypt
from jose import JWTError, jwt

from app.core.config import settings

_token_blacklist: set[str] = set()


def hash_password(plain: str) -> str:
    return _bcrypt.hashpw(plain.encode(), _bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


def create_access_token(data: dict[str, Any]) -> str:
    payload = data.copy()
    payload["exp"] = datetime.now(timezone.utc) + timedelta(
        minutes=settings.jwt_expire_minutes
    )
    payload["jti"] = str(uuid.uuid4())  # 동일 초 내 중복 토큰 방지
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def verify_token(token: str) -> dict[str, Any]:
    if token in _token_blacklist:
        raise JWTError("Token revoked")
    return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])


def revoke_token(token: str) -> None:
    _token_blacklist.add(token)
