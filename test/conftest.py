"""pytest 공용 픽스처 — 격리된 SQLite DB + 임시 Addon 경로로 앱을 부팅한다 (E2, MAS-Basic 이식).

환경변수는 `app.core.config.settings` import 전에 주입해야 하므로 모듈 최상단에서 설정한다.
"""
import os
import tempfile
from pathlib import Path

import pytest

_TMP = Path(tempfile.mkdtemp(prefix="secuardian-basic-test-"))
os.environ.update(
    {
        "ENV": "local",
        "DATABASE_URL": f"sqlite:///{_TMP / 'test.db'}",
        "ADDON_DEPLOYED_PATH": str(_TMP / "deployed"),
        "ADDON_FRONT_DEPLOYED_PATH": str(_TMP / "front-deployed"),
        "ADDON_DATA_PATH": str(_TMP / "data"),
        "ADDON_WEB_REBUILD": "none",
        "ADDON_DEPS_INSTALL": "true" if os.environ.get("SB_TEST_INSTALL_DEPS") == "1" else "false",
        "OLLAMA_WARMUP_ENABLED": "false",
        "MARKETPLACE_ENABLED": "false",
        "JWT_SECRET_KEY": "test-secret-key-0123456789abcdef0123456789",
        "DEFAULT_ADMIN_USER_ID": "admin",
        "DEFAULT_ADMIN_PASSWORD": "Admin123!",
        "ANTHROPIC_API_KEY": "",
    }
)

ROOT = Path(__file__).resolve().parents[1]
TMP = _TMP


@pytest.fixture(scope="session")
async def app():
    from app.main import app as _app

    async with _app.router.lifespan_context(_app):
        yield _app


@pytest.fixture(scope="session")
async def client(app):
    import httpx

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture(scope="session")
async def token(client) -> str:
    r = await client.post("/api/auth/login", json={"user_id": "admin", "password": "Admin123!"})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def auth(token):
    return {"Authorization": f"Bearer {token}"}
