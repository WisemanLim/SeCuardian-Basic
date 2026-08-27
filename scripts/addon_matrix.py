"""전 zip 설치 매트릭스 진단 — addon-agents/zip/*.zip 전량을 실제 업로드 파이프라인으로 설치.

사용: SB_TEST_INSTALL_DEPS=1 uv run python scripts/addon_matrix.py
결과: OK / REJECTED(worker 등 의도된 거부) / FAIL(사유) 표.
"""
import asyncio
import os
import sys
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="sb-matrix-"))
os.environ.update({
    "ENV": "local",
    "DATABASE_URL": f"sqlite:///{_TMP/'m.db'}",
    "ADDON_DEPLOYED_PATH": str(_TMP/"deployed"),
    "ADDON_FRONT_DEPLOYED_PATH": str(_TMP/"front"),
    "ADDON_DATA_PATH": str(_TMP/"data"),
    "ADDON_WEB_REBUILD": "none",
    "ADDON_DEPS_INSTALL": os.environ.get("SB_TEST_INSTALL_DEPS", "0") == "1" and "true" or "false",
    "OLLAMA_WARMUP_ENABLED": "false",
    "MARKETPLACE_ENABLED": "false",
    "JWT_SECRET_KEY": "matrix-secret-key-0123456789abcdef012345",
    "DEFAULT_ADMIN_USER_ID": "admin",
    "DEFAULT_ADMIN_PASSWORD": "Admin123!",
    "ANTHROPIC_API_KEY": "",
})

import httpx  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
ZIPS = sorted((ROOT/"addon-agents"/"zip").glob("*.zip"))


async def main() -> int:
    from app.main import app
    rows = []
    async with app.router.lifespan_context(app):
        tr = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=tr, base_url="http://m", timeout=120) as c:
            r = await c.post("/api/auth/login", json={"user_id": "admin", "password": "Admin123!"})
            auth = {"Authorization": f"Bearer {r.json()['access_token']}"}
            for z in ZIPS:
                r = await c.post("/api/addon-agents/upload", data={"force": "true"},
                                 files={"file": (z.name, z.read_bytes(), "application/zip")}, headers=auth)
                if r.status_code == 200:
                    j = r.json()
                    warn = ",".join(j.get("missing_env") or []) if isinstance(j, dict) else ""
                    rows.append((z.stem, "OK", f"missing_env={warn}" if warn else ""))
                elif z.stem.endswith("_worker") and r.status_code == 400:
                    rows.append((z.stem, "REJECTED(worker)", ""))
                else:
                    try:
                        d = r.json().get("detail")
                        msg = d.get("message", d.get("code", "")) if isinstance(d, dict) else str(d)
                    except Exception:
                        msg = r.text[:120]
                    rows.append((z.stem, f"FAIL {r.status_code}", msg[:160]))
    w = max(len(a) for a, _, _ in rows)
    fails = 0
    for a, b, cmt in rows:
        print(f"{a:<{w}}  {b:<18} {cmt}")
        fails += b.startswith("FAIL")
    print(f"\n== {len(rows)} zips: {sum(b=='OK' for _,b,_ in rows)} ok / {sum('REJECTED' in b for _,b,_ in rows)} rejected / {fails} fail")
    return 1 if fails else 0


sys.exit(asyncio.run(main()))
