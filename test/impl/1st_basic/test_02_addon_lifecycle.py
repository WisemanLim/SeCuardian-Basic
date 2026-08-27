"""E2 — Addon 업로드·호출·토글·재업로드(force)·삭제 라이프사이클 (D2/D3/D4 검증)."""
import json

from util_addon import ROOT, make_zip, upload

APP_SDK = '''
from fastapi import APIRouter, Depends
from app.addon_sdk import get_current_user, fetch_all, execute_insert, PH

router = APIRouter(prefix="/items", tags=["t1"])

@router.get("")
async def list_items(user: dict = Depends(get_current_user)):
    return {"items": await fetch_all("SELECT * FROM tbl_t1_items ORDER BY id")}

@router.post("")
async def add_item(body: dict, user: dict = Depends(get_current_user)):
    new_id = await execute_insert(f"INSERT INTO tbl_t1_items (name) VALUES ({PH})", (body["name"],))
    return {"id": new_id, "v": VERSION}

VERSION = 1
'''

SQL_T1 = """
-- 주석에 세미콜론; 포함 (split_sql 검증)
CREATE TABLE IF NOT EXISTS tbl_t1_items (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'a;b',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
"""

META_T1 = {
    "schema_version": 2,
    "agent_key": "t1",
    "display_name": "T1 Agent",
    "description": "test addon",
    "version": "1.2.3",
    "requires": {"core": ">=1.0.0", "sdk": ">=1.0.0"},
    "tables_owned": ["tbl_t1_items"],
}


async def test_upload_board_template_zip(client, auth):
    """addon-agents/_templates/Board.zip (meta v2) 업로드 → 라우트 활성."""
    data = (ROOT / "addon-agents" / "_templates" / "Board.zip").read_bytes()
    r = await upload(client, auth, "Board.zip", data)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["agent_key"] == "board" and body["has_app"] and body["has_front"]
    assert body["version"] == "1.1.0" and len(body["checksum"]) == 64
    assert body["installed_from"] == "upload"
    r = await client.get("/api/addon/board/posts", headers=auth)
    assert r.status_code == 200, r.text


async def test_board_toggle_unloads_routes(client, auth):
    """토글 비활성 → 라우트 실제 제거(D3), 재활성 → 복원."""
    r = await client.patch("/api/addon-agents/board/toggle", headers=auth)
    assert r.status_code == 200 and r.json()["is_active"] is False
    r = await client.get("/api/addon/board/posts", headers=auth)
    assert r.status_code == 404
    r = await client.patch("/api/addon-agents/board/toggle", headers=auth)
    assert r.status_code == 200 and r.json()["is_active"] is True
    r = await client.get("/api/addon/board/posts", headers=auth)
    assert r.status_code == 200


async def test_upload_sdk_addon_and_call(client, auth):
    fname, data = make_zip("T1", {"T1-app.py": APP_SDK, "T1-sql.sql": SQL_T1,
                                  "T1-meta.json": json.dumps(META_T1)})
    r = await upload(client, auth, fname, data)
    assert r.status_code == 200, r.text
    assert r.json()["version"] == "1.2.3"

    r = await client.post("/api/addon/t1/items", json={"name": "x"}, headers=auth)
    assert r.status_code == 200, r.text
    assert r.json()["id"] >= 1 and r.json()["v"] == 1
    r = await client.get("/api/addon/t1/items", headers=auth)
    assert r.json()["items"][0]["name"] == "x"

    # D2/B-7 — sql_path·manifest_json·checksum 저장 확인
    from app.db import fetch_one
    row = await fetch_one(
        "SELECT sql_path, manifest_json, checksum, installed_from FROM tbl_addon_agents WHERE agent_key='t1'")
    assert row["sql_path"].endswith("T1-sql.sql")
    m = json.loads(row["manifest_json"])
    assert m["schema_version"] == 2 and m["tables_owned"] == ["tbl_t1_items"]
    assert len(row["checksum"]) == 64 and row["installed_from"] == "upload"

    r = await client.get("/api/addon-agents/t1/manifest", headers=auth)
    assert r.status_code == 200
    assert r.json()["manifest"]["agent_key"] == "t1"
    assert r.json()["scan_result"]["blocked"] is False


async def test_duplicate_then_force_reupload(client, auth):
    """중복 409(duplicate) → force 재업로드 시 신 라우터로 교체 (D3)."""
    app_v2 = APP_SDK.replace("VERSION = 1", "VERSION = 2")
    fname, data = make_zip("T1", {"T1-app.py": app_v2, "T1-sql.sql": SQL_T1,
                                  "T1-meta.json": json.dumps({**META_T1, "version": "1.2.4"})})
    r = await upload(client, auth, fname, data)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "duplicate"
    r = await upload(client, auth, fname, data, force=True)
    assert r.status_code == 200 and r.json()["version"] == "1.2.4"
    r = await client.post("/api/addon/t1/items", json={"name": "y"}, headers=auth)
    assert r.status_code == 200 and r.json()["v"] == 2  # 구버전 핸들러가 남아있지 않음


async def test_sql_failure_is_surfaced_and_rolled_back(client, auth):
    """SQL strict 실패 → 400 + 사유, deployed/ 미설치 (D4)."""
    from app.core.config import settings
    from pathlib import Path
    fname, data = make_zip("T9", {"T9-app.py": APP_SDK, "T9-sql.sql": "CREATE TABLEE broken (;"})
    r = await upload(client, auth, fname, data)
    assert r.status_code == 400, r.text
    assert r.json()["detail"]["code"] == "sql_failed"
    assert not (Path(settings.addon_deployed_path) / "t9").exists()


async def test_delete_removes_routes_and_tables(client, auth):
    from app.db import fetch_one
    r = await client.delete("/api/addon-agents/t1", headers=auth)
    assert r.status_code == 200, r.text
    r = await client.get("/api/addon/t1/items", headers=auth)
    assert r.status_code == 404
    row = await fetch_one("SELECT name FROM sqlite_master WHERE type='table' AND name='tbl_t1_items'")
    assert row is None  # tables_owned DROP
    row = await fetch_one("SELECT agent_key FROM tbl_addon_agents WHERE agent_key='t1'")
    assert row is None


async def test_delete_board(client, auth):
    r = await client.delete("/api/addon-agents/board", headers=auth)
    assert r.status_code == 200
    r = await client.get("/api/addon/board/posts", headers=auth)
    assert r.status_code == 404
