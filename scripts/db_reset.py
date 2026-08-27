#!/usr/bin/env python3
"""DB 초기화 스크립트 — 데이터 삭제 후 스키마 재생성.

Usage:
    uv run python scripts/db_reset.py
    make db-reset
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import settings


async def main() -> None:
    db_url = settings.database_url

    if db_url.startswith("sqlite"):
        db_path = db_url.replace("sqlite:///./", "./").replace("sqlite:///", "")
        if os.path.exists(db_path):
            os.remove(db_path)
            print(f"[db-reset] 삭제: {db_path}")
        else:
            print(f"[db-reset] 파일 없음: {db_path}")
    else:
        # PostgreSQL: 모든 테이블 데이터 삭제 (스키마 유지)
        import psycopg2  # type: ignore
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        tables = ["tbl_audit_log", "tbl_agent_registry", "tbl_addon_agents",
                  "tbl_agent_config", "tbl_settings", "tbl_users"]
        for t in tables:
            cur.execute(f"TRUNCATE TABLE {t} RESTART IDENTITY CASCADE")
            print(f"[db-reset] TRUNCATE {t}")
        conn.commit()
        conn.close()

    # 스키마 재생성
    from app.db import run_migrations, apply_column_migrations
    await run_migrations()
    await apply_column_migrations()
    print("[db-reset] 스키마 초기화 완료. Setup Wizard에서 초기 설정을 진행하세요.")


if __name__ == "__main__":
    asyncio.run(main())
