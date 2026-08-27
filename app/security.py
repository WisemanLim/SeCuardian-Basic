"""호환성 shim — SmartHaccp addon에서 `from app import security` 사용 시.

addon-agent 의 Board 등 기존 SmartHaccp 코드는 `security.get_current_user(credentials, conn)` 를 호출한다.
이 파일은 해당 인터페이스를 템플릿 구조에 맞게 위임한다.
"""
from app.core.security import (
    create_access_token,
    hash_password,
    revoke_token,
    verify_password,
    verify_token,
)

__all__ = [
    "create_access_token",
    "get_current_user",
    "hash_password",
    "revoke_token",
    "verify_password",
    "verify_token",
]


def get_current_user(credentials, conn=None) -> dict:
    """SmartHaccp addon 호환: `get_current_user(credentials, conn)`.

    conn 파라미터는 무시 (템플릿은 DB 조회 없이 JWT 페이로드 직접 반환).
    반환값: { sub, user_id, role, exp, ... }
    """
    return verify_token(credentials.credentials)
