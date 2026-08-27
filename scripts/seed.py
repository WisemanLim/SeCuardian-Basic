#!/usr/bin/env python3
"""시드 스크립트 — 기본 설정 + 테스트 데이터 삽입.

Usage:
    uv run python scripts/seed.py
    make seed

포함 내용 (기반 시드만 — R20-2):
  - tbl_settings: LLM 기본값 (ollama, claude 모델명, setup_completed=false)
  - tbl_users: supervisor(secuardian/Secu1234!) + admin(test-admin/Admin1234!) + user(test-user/User1234!)

보안 도메인 에이전트는 코어에 시드하지 않는다 — Addon 패키지(SeCMP security/ 카테고리)로 설치한다.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import settings as _settings
from app.core.security import hash_password
from app.db import execute_write, fetch_one, run_migrations, apply_column_migrations, _IS_SQLITE, _PH


# env var / .env.* 파일 값 우선 반영 — 하드코딩 대신 settings.* 사용
SETTINGS = [
    ("orchestrator_model",  _settings.orchestrator_model, "Orchestrator LLM 모델"),
    ("domain_agent_model",  _settings.domain_agent_model, "Domain Agent LLM 모델"),
    ("ollama_base_url",     _settings.ollama_base_url,    "Ollama 서버 주소"),
    ("ollama_model",        _settings.ollama_model,       "Ollama 기본 모델"),
    ("fallback_enabled",    "true",                       "LLM Fallback 활성화"),
    ("setup_completed",     "false",                      "Setup Wizard 완료"),
]

TEST_USERS = [
    ("secuardian",  "supervisor",   "Secu1234!",  "supervisor"),
    ("test-admin",  "테스트관리자", "Admin1234!", "admin"),
    ("test-user",   "테스트사용자", "User1234!",  "user"),
]


async def main() -> None:
    # 스키마 보장 (아직 없으면 생성) — 컬럼 ALTER 먼저, 그 다음 init+seed (main.py lifespan 과 동일 순서)
    await apply_column_migrations()
    await run_migrations()

    _conflict = "OR IGNORE" if _IS_SQLITE else ""
    _on_conflict = "" if _IS_SQLITE else "ON CONFLICT DO NOTHING"

    # tbl_settings
    for key, value, desc in SETTINGS:
        await execute_write(
            f"INSERT {_conflict} INTO tbl_settings (key, value, description) VALUES ({_PH},{_PH},{_PH}) {_on_conflict}",
            (key, value, desc),
        )
        print(f"[seed] settings: {key} = {value}")

    # tbl_users
    for user_id, username, password, role in TEST_USERS:
        row = await fetch_one(f"SELECT 1 FROM tbl_users WHERE user_id={_PH}", (user_id,))
        if row:
            print(f"[seed] users: {user_id} (이미 존재, 건너뜀)")
        else:
            await execute_write(
                f"INSERT INTO tbl_users (user_id, username, password, role) VALUES ({_PH},{_PH},{_PH},{_PH})",
                (user_id, username, hash_password(password), role),
            )
            print(f"[seed] users: {user_id} ({role}) 생성")

    print("\n[seed] 완료!")
    print("  supervisor: secuardian / Secu1234!")
    print("  admin:      test-admin / Admin1234!")
    print("  user:       test-user  / User1234!")


if __name__ == "__main__":
    asyncio.run(main())
