"""E2 — 코어 부팅·마이그레이션·SDK 계약 검증."""


async def test_health(client):
    r = await client.get("/health")
    assert r.status_code == 200


async def test_login_and_templates(client, auth):
    r = await client.get("/api/addon-agents/templates/list", headers=auth)
    assert r.status_code == 200, r.text
    names = {t["name"] for t in r.json()["templates"]}
    assert {"Board", "RagAgent", "ServiceAgent", "ToolProxyAgent", "UserManager"} <= names


async def test_addon_columns_migrated(app):
    """tbl_addon_agents 신규 컬럼 + tbl_addon_dependencies 생성 확인 (PRD B-7)."""
    from app.db import fetch_all, fetch_one
    cols = {c["name"] for c in await fetch_all("PRAGMA table_info(tbl_addon_agents)")}
    assert {"version", "checksum", "manifest_json", "installed_from", "scan_result"} <= cols
    row = await fetch_one(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='tbl_addon_dependencies'"
    )
    assert row is not None


async def test_sdk_contract(app):
    """PRD B-1.2 — SDK 공개 심볼·버전, 호환 shim 유지."""
    import app.addon_sdk as sdk

    assert sdk.__sdk_version__ == "1.0.0"
    for sym in [
        "get_current_user", "require_role", "fetch_all", "fetch_one", "execute_write",
        "execute_insert", "PH", "IS_SQLITE", "settings", "BASE_DIR", "call_llm",
        "addon_data_dir", "addon_file", "norm_descriptions", "parse_lang_map",
    ]:
        assert sym in sdk.__all__ and hasattr(sdk, sym), sym
    # 호환 shim — 기존 addon 의 비공개 import 는 계속 동작
    from app.core.deps import get_current_user  # noqa: F401
    from app.db import _PH  # noqa: F401
    assert sdk.PH == _PH
    # addon_data_dir 는 ADDON_DATA_PATH 이하 (CWD 비의존)
    from app.core.config import settings
    d = sdk.addon_data_dir("t_sdk")
    assert d.is_dir() and str(d).startswith(settings.addon_data_path)
    assert str(sdk.addon_file("t_sdk", "sample.csv")).startswith(settings.addon_deployed_path)
