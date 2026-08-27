"""로컬 SQLite 시드 스크립트 — make up 없이 빠른 초기화."""
import asyncio
import sys
sys.path.insert(0, ".")

from app.db import run_migrations, seed_default_admin


async def main():
    print("Running migrations...")
    await run_migrations()
    print("Seeding default admin...")
    await seed_default_admin()
    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
