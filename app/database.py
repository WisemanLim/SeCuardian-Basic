"""호환성 shim — SmartHaccp addon에서 `from app.database import get_db` 사용 시.

SmartHaccp 패턴:
    conn = Depends(get_db)
    cur  = conn.cursor()
    cur.execute("SELECT ... WHERE id = %s", (id,))
    row  = cur.fetchone()   # → dict
    conn.commit()

SQLite 환경에서 `%s` → `?` 변환을 자동 처리한다.
"""
import sqlite3 as _sqlite3
from typing import Generator

from app.core.config import settings

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor as _RDC
    _HAS_PSYCOPG2 = True
except ImportError:
    _HAS_PSYCOPG2 = False


def _is_sqlite() -> bool:
    return settings.database_url.startswith("sqlite")


# ── SQLite wrapper ────────────────────────────────────────────────────────────

class _SqliteCursor:
    """sqlite3.Cursor → psycopg2 RealDictCursor 인터페이스 래퍼."""

    def __init__(self, cur: _sqlite3.Cursor) -> None:
        self._cur = cur

    def execute(self, query: str, params=None):
        self._cur.execute(query.replace("%s", "?"), params or ())
        return self

    def fetchone(self):
        row = self._cur.fetchone()
        return dict(row) if row else None

    def fetchall(self):
        return [dict(r) for r in self._cur.fetchall()]

    def close(self) -> None:
        self._cur.close()

    @property
    def rowcount(self) -> int:
        return self._cur.rowcount

    @property
    def lastrowid(self):
        return self._cur.lastrowid


class _SqliteConn:
    """sqlite3.Connection → psycopg2 connection 인터페이스 래퍼."""

    def __init__(self, path: str) -> None:
        self._conn = _sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = _sqlite3.Row

    def cursor(self) -> _SqliteCursor:
        return _SqliteCursor(self._conn.cursor())

    def commit(self) -> None:
        self._conn.commit()

    def rollback(self) -> None:
        self._conn.rollback()

    def close(self) -> None:
        self._conn.close()


# ── 연결 팩토리 ───────────────────────────────────────────────────────────────

def get_connection():
    if _is_sqlite():
        path = settings.database_url.replace("sqlite:///", "").replace("sqlite://", "")
        return _SqliteConn(path)
    if _HAS_PSYCOPG2:
        return psycopg2.connect(settings.database_url, cursor_factory=_RDC)
    raise RuntimeError("psycopg2 미설치 — PostgreSQL 연결 불가")


def get_db() -> Generator:
    """FastAPI Dependency — 성공 시 commit, 예외 시 rollback."""
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
