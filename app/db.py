"""DB 초기화·마이그레이션·시드 헬퍼."""
import logging

from app.core.config import settings
from app.core.security import hash_password

logger = logging.getLogger("uvicorn.error")

_IS_SQLITE = settings.database_url.startswith("sqlite")
_PH = "?" if _IS_SQLITE else "%s"


def _db_path() -> str:
    return settings.database_url.replace("sqlite:///./", "./").replace("sqlite:///", "")


async def fetch_one(sql: str, params: tuple = ()) -> dict | None:
    if _IS_SQLITE:
        import aiosqlite
        async with aiosqlite.connect(_db_path()) as conn:
            conn.row_factory = aiosqlite.Row
            async with conn.execute(sql, params) as cur:
                row = await cur.fetchone()
                return dict(row) if row else None
    else:
        import psycopg2, psycopg2.extras  # noqa: E401
        conn = psycopg2.connect(settings.database_url)
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(sql, params)
        row = cur.fetchone()
        conn.close()
        return dict(row) if row else None


async def fetch_all(sql: str, params: tuple = ()) -> list[dict]:
    if _IS_SQLITE:
        import aiosqlite
        async with aiosqlite.connect(_db_path()) as conn:
            conn.row_factory = aiosqlite.Row
            async with conn.execute(sql, params) as cur:
                rows = await cur.fetchall()
                return [dict(r) for r in rows]
    else:
        import psycopg2, psycopg2.extras  # noqa: E401
        conn = psycopg2.connect(settings.database_url)
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(sql, params)
        rows = cur.fetchall()
        conn.close()
        return [dict(r) for r in rows]


async def execute_write(sql: str, params: tuple = ()) -> None:
    if _IS_SQLITE:
        import aiosqlite
        async with aiosqlite.connect(_db_path()) as conn:
            await conn.execute(sql, params)
            await conn.commit()
    else:
        import psycopg2
        conn = psycopg2.connect(settings.database_url)
        cur = conn.cursor()
        cur.execute(sql, params)
        conn.commit()
        conn.close()


async def execute_insert(sql: str, params: tuple = ()) -> int:
    """INSERT 실행 후 생성된 row id 반환."""
    if _IS_SQLITE:
        import aiosqlite
        async with aiosqlite.connect(_db_path()) as conn:
            cur = await conn.execute(sql, params)
            await conn.commit()
            return cur.lastrowid or 0
    else:
        import psycopg2
        pg_sql = sql.rstrip().rstrip(";") + " RETURNING id"
        conn = psycopg2.connect(settings.database_url)
        cur = conn.cursor()
        cur.execute(pg_sql, params)
        row = cur.fetchone()
        conn.commit()
        conn.close()
        return row[0] if row else 0


_SEED_DIGEST_KEY = "seed_sql_digest"


async def _seed_already_applied(path: str) -> tuple[bool, str]:
    """02_seed.sql 적용 여부 — 파일 sha256 을 tbl_settings 마커와 비교.

    make *-all 등 재기동만으로 seed 의 UPDATE/DELETE 가 반복 실행되어
    운영 중 변경한 에이전트 설정이 되돌아가는 문제 방지.
    파일이 바뀐 릴리즈에서만 1회 재적용된다. (명시적 초기화는 make db-fresh)
    """
    import hashlib
    digest = hashlib.sha256(open(path, "rb").read()).hexdigest()
    try:
        row = await fetch_one(
            f"SELECT value FROM tbl_settings WHERE key = {_PH}", (_SEED_DIGEST_KEY,)
        )
        return (bool(row) and row.get("value") == digest, digest)
    except Exception:
        # tbl_settings 미생성(신규 DB) — 미적용으로 판정
        return (False, digest)


async def _mark_seed_applied(digest: str) -> None:
    if _IS_SQLITE:
        await execute_write(
            f"INSERT OR REPLACE INTO tbl_settings (key, value, description) "
            f"VALUES ({_PH}, {_PH}, '02_seed.sql 적용 마커 (파일 sha256)')",
            (_SEED_DIGEST_KEY, digest),
        )
    else:
        await execute_write(
            f"INSERT INTO tbl_settings (key, value, description) "
            f"VALUES ({_PH}, {_PH}, '02_seed.sql 적용 마커 (파일 sha256)') "
            f"ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (_SEED_DIGEST_KEY, digest),
        )


async def _exec_sql_files(paths: list[str]) -> None:
    if not paths:
        return
    if _IS_SQLITE:
        import aiosqlite
        async with aiosqlite.connect(_db_path()) as conn:
            for path in paths:
                with open(path) as f:
                    await conn.executescript(f.read())
            await conn.commit()
    else:
        import psycopg2
        conn = psycopg2.connect(settings.database_url)
        conn.autocommit = True
        cur = conn.cursor()
        for path in paths:
            with open(path) as f:
                cur.execute(f.read())
        conn.close()


async def run_migrations() -> None:
    """SQL 파일 순차 실행 (idempotent — IF NOT EXISTS 전제).

    02_seed.sql 은 UPDATE/DELETE 를 포함하므로 매 기동 실행하지 않고,
    파일 해시 마커로 최초 1회(및 파일 변경 릴리즈 시)만 적용한다.
    나머지(01_init, 03_standalone_seed 등)는 멱등 구문만 포함 — 매 기동 실행.
    """
    import glob
    import os

    sql_dir = "sql/sqlite" if _IS_SQLITE else "sql/pg"
    sql_files = sorted(glob.glob(f"{sql_dir}/*.sql"))
    if not sql_files:
        return

    executed = 0
    for path in sql_files:
        if "02_seed" in os.path.basename(path):
            applied, digest = await _seed_already_applied(path)
            if applied:
                logger.info("[db] seed skip (unchanged): %s", path)
                continue
            await _exec_sql_files([path])
            await _mark_seed_applied(digest)
            logger.info("[db] seed applied: %s", path)
        else:
            await _exec_sql_files([path])
        executed += 1

    logger.info("[db] migrations OK (%d/%d files, %s)", executed, len(sql_files), sql_dir)


def _apply_pg_column_migrations() -> None:
    """PostgreSQL: ADD COLUMN IF NOT EXISTS (멱등, PostgreSQL 9.6+)."""
    import psycopg2
    migrations = [
        "ALTER TABLE tbl_agent_config ADD COLUMN IF NOT EXISTS model TEXT",
        "ALTER TABLE tbl_agent_config ADD COLUMN IF NOT EXISTS system_prompt TEXT",
        "ALTER TABLE tbl_agent_config ADD COLUMN IF NOT EXISTS is_required INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE tbl_agent_config ADD COLUMN IF NOT EXISTS description TEXT",
        "ALTER TABLE tbl_agent_config ADD COLUMN IF NOT EXISTS description_en TEXT",
        "ALTER TABLE tbl_agent_config ADD COLUMN IF NOT EXISTS descriptions TEXT",
        "ALTER TABLE tbl_agent_config ADD COLUMN IF NOT EXISTS agent_names TEXT",
        "ALTER TABLE tbl_agent_config ADD COLUMN IF NOT EXISTS disabled_reason TEXT",
        "ALTER TABLE tbl_agent_config ADD COLUMN IF NOT EXISTS disabled_reason_en TEXT",
        "ALTER TABLE tbl_users ADD COLUMN IF NOT EXISTS totp_secret TEXT",
        "ALTER TABLE tbl_users ADD COLUMN IF NOT EXISTS totp_enabled INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE tbl_users ADD COLUMN IF NOT EXISTS custom_instructions TEXT",
        "ALTER TABLE tbl_users ADD COLUMN IF NOT EXISTS preferred_lang VARCHAR(10)",
        "ALTER TABLE tbl_addon_agents ADD COLUMN IF NOT EXISTS has_app INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE tbl_addon_agents ADD COLUMN IF NOT EXISTS agent_type TEXT NOT NULL DEFAULT 'app'",
        "ALTER TABLE tbl_addon_agents ADD COLUMN IF NOT EXISTS meta_json TEXT",
        # E2: manifest v2 설치 이력 컬럼 (PRD B-7)
        "ALTER TABLE tbl_addon_agents ADD COLUMN IF NOT EXISTS version TEXT DEFAULT '1.0.0'",
        "ALTER TABLE tbl_addon_agents ADD COLUMN IF NOT EXISTS checksum TEXT",
        "ALTER TABLE tbl_addon_agents ADD COLUMN IF NOT EXISTS manifest_json TEXT",
        "ALTER TABLE tbl_addon_agents ADD COLUMN IF NOT EXISTS installed_from TEXT",
        "ALTER TABLE tbl_addon_agents ADD COLUMN IF NOT EXISTS scan_result TEXT",
        # E2: addon 의존성 설치 이력 (PRD B-7)
        """CREATE TABLE IF NOT EXISTS tbl_addon_dependencies (
            id SERIAL PRIMARY KEY, agent_key TEXT NOT NULL, package TEXT NOT NULL,
            spec TEXT, installed_at TIMESTAMP DEFAULT NOW())""",
        # F23: tbl_agent_registry v2 columns
        "ALTER TABLE tbl_agent_registry ADD COLUMN IF NOT EXISTS agent_type TEXT NOT NULL DEFAULT 'service'",
        "ALTER TABLE tbl_agent_registry ADD COLUMN IF NOT EXISTS capabilities_json TEXT",
        "ALTER TABLE tbl_agent_registry ADD COLUMN IF NOT EXISTS agent_card_json TEXT",
        "ALTER TABLE tbl_agent_registry ADD COLUMN IF NOT EXISTS lifecycle_state TEXT NOT NULL DEFAULT 'active'",
        "ALTER TABLE tbl_agent_registry ADD COLUMN IF NOT EXISTS health_score NUMERIC(5,4) NOT NULL DEFAULT 1.0",
        "ALTER TABLE tbl_agent_registry ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMP",
        "ALTER TABLE tbl_agent_registry ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMP",
        # F23: tbl_addon_agent_capabilities (new table)
        """CREATE TABLE IF NOT EXISTS tbl_addon_agent_capabilities (
            id SERIAL PRIMARY KEY, agent_key VARCHAR(50) NOT NULL,
            capability_key VARCHAR(100) NOT NULL, verb VARCHAR(50) NOT NULL,
            domain VARCHAR(200) NOT NULL, description TEXT,
            input_schema TEXT, output_schema TEXT, qos_json TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            UNIQUE(agent_key, capability_key))""",
    ]
    conn = psycopg2.connect(settings.database_url)
    conn.autocommit = True
    cur = conn.cursor()
    for sql in migrations:
        try:
            cur.execute(sql)
        except Exception as e:
            logger.warning("[db] pg column migration skip: %s", e)
    conn.close()
    logger.info("[db] pg column migrations OK")


async def apply_column_migrations() -> None:
    """기존 DB에 누락된 컬럼을 추가한다 (ALTER TABLE, 멱등)."""
    if not _IS_SQLITE:
        _apply_pg_column_migrations()
        return
    import aiosqlite
    async with aiosqlite.connect(_db_path()) as conn:
        async with conn.execute("PRAGMA table_info(tbl_agent_config)") as cur:
            cols = {row[1] async for row in cur}
        # cols 비어 있으면 테이블 미생성(신규 DB) — run_migrations 의 01_init.sql 이 전체 스키마로 생성
        for col, typedef in ([
            ("model", "TEXT"),
            ("system_prompt", "TEXT"),
            ("is_required", "INTEGER NOT NULL DEFAULT 0"),
            ("description", "TEXT"),
            ("description_en", "TEXT"),
            ("descriptions", "TEXT"),
            ("agent_names", "TEXT"),
            ("disabled_reason", "TEXT"),
            ("disabled_reason_en", "TEXT"),
        ] if cols else []):
            col_name = col.split()[0]
            if col_name not in cols:
                await conn.execute(f"ALTER TABLE tbl_agent_config ADD COLUMN {col} {typedef}")
                logger.info("[db] added column tbl_agent_config.%s", col_name)
        await conn.commit()

    # tbl_users — TOTP columns
    async with aiosqlite.connect(_db_path()) as conn:
        async with conn.execute("PRAGMA table_info(tbl_users)") as cur:
            user_cols = {row[1] async for row in cur}
        for col, typedef in ([
            ("totp_secret", "TEXT"),
            ("totp_enabled", "INTEGER NOT NULL DEFAULT 0"),
            ("custom_instructions", "TEXT"),
            ("preferred_lang", "VARCHAR(10)"),
        ] if user_cols else []):
            col_name = col.split()[0]
            if col_name not in user_cols:
                await conn.execute(f"ALTER TABLE tbl_users ADD COLUMN {col_name} {typedef}")
                logger.info("[db] added column tbl_users.%s", col_name)
        await conn.commit()

    # tbl_addon_agents — has_app + agent_type + meta_json columns (F22)
    async with aiosqlite.connect(_db_path()) as conn:
        async with conn.execute("PRAGMA table_info(tbl_addon_agents)") as cur:
            addon_cols = {row[1] async for row in cur}
        for col, typedef in ([
            ("has_app", "INTEGER NOT NULL DEFAULT 0"),
            ("agent_type", "TEXT NOT NULL DEFAULT 'app'"),
            ("meta_json", "TEXT"),
            # E2: manifest v2 설치 이력 컬럼 (PRD B-7)
            ("version", "TEXT DEFAULT '1.0.0'"),
            ("checksum", "TEXT"),
            ("manifest_json", "TEXT"),
            ("installed_from", "TEXT"),
            ("scan_result", "TEXT"),
        ] if addon_cols else []):
            if col not in addon_cols:
                await conn.execute(f"ALTER TABLE tbl_addon_agents ADD COLUMN {col} {typedef}")
                logger.info("[db] added column tbl_addon_agents.%s", col)
        await conn.commit()

    # tbl_agent_registry — F23 v2 columns
    async with aiosqlite.connect(_db_path()) as conn:
        async with conn.execute("PRAGMA table_info(tbl_agent_registry)") as cur:
            reg_cols = {row[1] async for row in cur}
        for col, typedef in ([
            ("agent_type", "TEXT NOT NULL DEFAULT 'service'"),
            ("capabilities_json", "TEXT"),
            ("agent_card_json", "TEXT"),
            ("lifecycle_state", "TEXT NOT NULL DEFAULT 'active'"),
            ("health_score", "REAL NOT NULL DEFAULT 1.0"),
            ("last_heartbeat_at", "TIMESTAMP"),
            ("lease_expires_at", "TIMESTAMP"),
        ] if reg_cols else []):
            if col not in reg_cols:
                await conn.execute(f"ALTER TABLE tbl_agent_registry ADD COLUMN {col} {typedef}")
                logger.info("[db] added column tbl_agent_registry.%s", col)
        # tbl_addon_agent_capabilities (새 테이블)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS tbl_addon_agent_capabilities (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_key      TEXT NOT NULL,
                capability_key TEXT NOT NULL,
                verb           TEXT NOT NULL,
                domain         TEXT NOT NULL,
                description    TEXT,
                input_schema   TEXT,
                output_schema  TEXT,
                qos_json       TEXT,
                created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(agent_key, capability_key)
            )
        """)
        # E2: addon 의존성 설치 이력 (PRD B-7)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS tbl_addon_dependencies (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_key    TEXT NOT NULL,
                package      TEXT NOT NULL,
                spec         TEXT,
                installed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await conn.commit()
        logger.info("[db] tbl_addon_agent_capabilities ensured")


async def backfill_descriptions() -> None:
    """R18-7: 레거시 컬럼 → 다국어 JSON 멱등 백필.

    - descriptions: description(ko)/description_en(en) 에서 병합
    - agent_names: agent_name 에서 {"ko": ...} 생성 (en 은 시드/업로드 meta 로 보강)
    비어 있는 행만 대상. 레거시 컬럼은 하위호환용으로 유지한다.
    """
    import json as _json

    rows = await fetch_all(
        "SELECT agent_key, agent_name, description, description_en, descriptions, agent_names "
        "FROM tbl_agent_config"
    )
    filled = names_filled = 0
    for r in rows:
        if not (r.get("descriptions") or "").strip():
            d: dict[str, str] = {}
            if (r.get("description") or "").strip():
                d["ko"] = r["description"].strip()
            if (r.get("description_en") or "").strip():
                d["en"] = r["description_en"].strip()
            if d:
                await execute_write(
                    f"UPDATE tbl_agent_config SET descriptions = {_PH} WHERE agent_key = {_PH}",
                    (_json.dumps(d, ensure_ascii=False), r["agent_key"]),
                )
                filled += 1
        if not (r.get("agent_names") or "").strip() and (r.get("agent_name") or "").strip():
            await execute_write(
                f"UPDATE tbl_agent_config SET agent_names = {_PH} WHERE agent_key = {_PH}",
                (_json.dumps({"ko": r["agent_name"].strip()}, ensure_ascii=False), r["agent_key"]),
            )
            names_filled += 1
    if filled or names_filled:
        logger.info("[db] backfilled: descriptions %d, agent_names %d", filled, names_filled)


async def seed_default_admin() -> None:
    """DEFAULT_ADMIN_USER_ID/PASSWORD 환경변수 설정 시에만 기본 관리자 계정 생성."""
    if not settings.default_admin_user_id or not settings.default_admin_password:
        return
    row = await fetch_one("SELECT COUNT(*) as cnt FROM tbl_users")
    if row and row["cnt"] == 0:
        await execute_write(
            f"INSERT INTO tbl_users (user_id, username, password, role) VALUES ({_PH},{_PH},{_PH},{_PH})",
            (
                settings.default_admin_user_id,
                settings.default_admin_user_id,
                hash_password(settings.default_admin_password),
                "supervisor",
            ),
        )
        logger.info("[db] default admin created: %s", settings.default_admin_user_id)
