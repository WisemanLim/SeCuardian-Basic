"""Addon Agent 동적 핫 디플로이 로더 (F4).

참조: SmartHaccp-MultiAgent / MAS-Basic app/addon_agent_loader.py
패턴: 소스 직접 compile → router 추출 → app.include_router()

SeCuardian-Basic 보정 (PRD B-6 결함 D1~D4):
- D1: 경로는 settings.addon_* (저장소 루트 기준 절대 경로) 사용 — CWD 비의존
- D2: DB 에 저장된 sql_path/router_path 가 사라진 경우 배포 디렉터리(key 기준)로 재해석 (_resolve)
- D3: 재업로드·비활성화·삭제 시 기존 라우트를 app.router.routes 에서 실제 제거 (_remove_routes)
- D4: apply_sql 은 실패를 삼키지 않고 반환/예외로 표면화 (strict=True 면 첫 실패에서 raise)
- SQL 문장 분리 시 문자열 리터럴·주석 내 ';' 무시 (split_sql)
- DDL 방언 양방향 변환 (PG→SQLite, SQLite→PG)
- `{agent_key}_lib/` 서브패키지 import 지원 (배포 디렉터리를 sys.path 에 등록)
"""
import logging
import re
import sys
import types
from pathlib import Path

from fastapi import FastAPI

from app.core.config import settings

logger = logging.getLogger("uvicorn.error")

_app: FastAPI | None = None
_active_prefixes: set[str] = set()  # /api/addon/{key} — 활성 라우트 추적


def deployed_dir() -> Path:
    return Path(settings.addon_deployed_path)


def front_deployed_dir() -> Path:
    return Path(settings.addon_front_deployed_path)


def addon_data_dir(agent_key: str) -> Path:
    """Addon 전용 데이터 디렉터리 (모델·업로드 파일 등, CWD 비의존 — ADDON_DATA_PATH)."""
    p = Path(settings.addon_data_path) / agent_key
    p.mkdir(parents=True, exist_ok=True)
    return p


def _resolve(agent_key: str, stored_path: str) -> str:
    """DB 에 저장된 경로 해석 (D2).

    상대경로는 저장소 루트 기준으로 해석하고, 그래도 파일이 없으면(과거 설치 경로·이설 등)
    파일명만 취해 배포 디렉터리 deployed/{agent_key}/ 기준으로 재해석한다.
    """
    if not stored_path:
        return ""
    from app.core.config import BASE_DIR
    p = Path(stored_path)
    if not p.is_absolute():
        p = BASE_DIR / p
    if p.exists():
        return str(p)
    fallback = deployed_dir() / agent_key / Path(stored_path).name
    return str(fallback) if fallback.exists() else str(p)


# ── SQL 방언 변환 ─────────────────────────────────────────────────────────────

def _pg_to_sqlite(sql: str) -> str:
    sql = re.sub(r"\bBIGSERIAL\b", "INTEGER", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bSERIAL\b", "INTEGER", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bBOOLEAN\b", "INTEGER", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bDEFAULT\s+NOW\s*\(\)", "DEFAULT CURRENT_TIMESTAMP", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bDEFAULT\s+FALSE\b", "DEFAULT 0", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bDEFAULT\s+TRUE\b", "DEFAULT 1", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bVARCHAR\s*\(\s*\d+\s*\)", "TEXT", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bTIMESTAMPTZ\b", "TIMESTAMP", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bJSONB\b", "TEXT", sql, flags=re.IGNORECASE)
    return sql


def _sqlite_to_pg(sql: str) -> str:
    sql = re.sub(
        r"\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b", "SERIAL PRIMARY KEY", sql, flags=re.IGNORECASE
    )
    sql = re.sub(r"\bAUTOINCREMENT\b", "", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bDATETIME\b", "TIMESTAMP", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bBLOB\b", "BYTEA", sql, flags=re.IGNORECASE)
    return sql


def normalize_ddl(sql: str) -> str:
    """현재 DB 방언에 맞게 DDL 정규화 (양방향)."""
    if settings.database_url.startswith("sqlite"):
        return _pg_to_sqlite(sql)
    return _sqlite_to_pg(sql)


def split_sql(sql_text: str) -> list[str]:
    """';' 로 문장 분리 — 문자열 리터럴('...'), 라인 주석(--), 블록 주석(/* */) 내부는 무시."""
    stmts: list[str] = []
    buf: list[str] = []
    i, n = 0, len(sql_text)
    in_str = False
    while i < n:
        ch = sql_text[i]
        if in_str:
            buf.append(ch)
            if ch == "'":
                if i + 1 < n and sql_text[i + 1] == "'":
                    buf.append("'")
                    i += 1
                else:
                    in_str = False
        elif ch == "'":
            in_str = True
            buf.append(ch)
        elif ch == "-" and sql_text.startswith("--", i):
            end = sql_text.find("\n", i)
            i = n if end == -1 else end
            continue
        elif ch == "/" and sql_text.startswith("/*", i):
            end = sql_text.find("*/", i + 2)
            i = n if end == -1 else end + 2
            continue
        elif ch == ";":
            stmt = "".join(buf).strip()
            if stmt:
                stmts.append(stmt)
            buf = []
        else:
            buf.append(ch)
        i += 1
    tail = "".join(buf).strip()
    if tail:
        stmts.append(tail)
    return stmts


def extract_table_names(sql_text: str) -> list[str]:
    """DDL 에서 CREATE TABLE 대상 테이블명 추출 (tables_owned 폴백)."""
    return re.findall(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[\"`]?(\w+)", sql_text, re.IGNORECASE)


async def apply_sql(sql_path: str, *, strict: bool = False) -> list[str]:
    """addon SQL 파일 실행. 실패 문장 목록을 반환하고, strict=True 면 첫 실패에서 RuntimeError (D4).

    기존 구현은 모든 예외를 `pass` 로 삼켰다 — 실패를 로그·반환값·예외로 표면화한다.
    """
    from app.db import execute_write
    path = Path(sql_path)
    if not path.exists():
        msg = f"sql_path not found: {sql_path}"
        logger.warning("[addon_loader] %s", msg)
        if strict:
            raise RuntimeError(msg)
        return [msg]
    errors: list[str] = []
    for stmt in split_sql(path.read_text(encoding="utf-8")):
        stmt = normalize_ddl(stmt)
        try:
            await execute_write(stmt)
        except Exception as exc:  # noqa: BLE001
            msg = f"{exc.__class__.__name__}: {exc} — {stmt[:120]}"
            logger.error("[addon_loader] sql 실패 (%s): %s", path.name, msg)
            if strict:
                raise RuntimeError(msg) from exc
            errors.append(msg)
    logger.info("[addon_loader] sql applied: %s (%d error)", sql_path, len(errors))
    return errors


async def init(app: FastAPI) -> None:
    global _app
    _app = app
    await _load_all_from_disk()


async def _load_all_from_disk() -> None:
    """DB 에 등록된 활성 Addon Agent — SQL 적용 후 라우터 로드 (앱 재시작 복원)."""
    from app.db import fetch_all
    # 설정에서 비활성화된 에이전트(tbl_agent_config.is_enabled=0)는 복원하지 않는다 —
    # 보안 승인 전 기본 비활성인 내장 에이전트(예: ai-eval-gate)의 라우트가 패키지 등록만으로
    # 열리던 결함 방지 (R22-6). 설정 행이 없는 순수 addon 은 기존대로 is_active 를 따른다.
    rows = await fetch_all(
        "SELECT a.agent_key, a.router_path, a.api_prefix, a.sql_path "
        "FROM tbl_addon_agents a "
        "LEFT JOIN tbl_agent_config c ON c.agent_key = a.agent_key "
        "WHERE a.is_active = 1 AND COALESCE(c.is_enabled, 1) = 1"
    )
    count = 0
    stale = 0
    for row in rows:
        key = row["agent_key"]
        router_path = _resolve(key, row.get("router_path") or "")
        # 소스 파일이 사라진 등록분(수동 삭제·배포 실패 잔여)은 오류가 아니라 경고로 알린다
        if router_path and not Path(router_path).exists():
            stale += 1
            logger.warning(
                "[addon_loader] %s 소스 없음 — 등록 정보만 남아 스킵: %s", key, router_path,
            )
            continue
        if row.get("sql_path"):
            await apply_sql(_resolve(key, row["sql_path"]))
        if load_router(key, router_path, row["api_prefix"]):
            count += 1
    logger.info(
        "[addon_loader] restored %d/%d addon(s) from DB%s",
        count, len(rows), f" (소스 없음 {stale}건)" if stale else "",
    )


# ── 라우트 등록·실제 제거 (D3) ───────────────────────────────────────────────

_included_routes: dict[str, list[object]] = {}  # api_prefix → include_router 가 추가한 라우트 객체


def _bump_router_version() -> None:
    """FastAPI ≥0.115 는 라우트 캐시를 _routes_version 으로 무효화 — 직접 mutate 후 bump."""
    if _app is None:
        return
    r = _app.router
    if hasattr(r, "_routes_version"):
        r._routes_version += 1
    _app.openapi_schema = None  # OpenAPI 캐시 무효화 (MCP 툴 목록 갱신)


def _remove_routes(api_prefix: str) -> int:
    """이 로더가 api_prefix 로 등록했던 라우트를 app.router.routes 에서 실제 제거 (재업로드·비활성화·삭제용).

    include 전후 routes diff 로 기억한 객체를 제거하고, 스냅샷이 없으면 path 기준 폴백.
    """
    if _app is None:
        return 0
    routes = _app.router.routes
    before = len(routes)
    tracked = _included_routes.pop(api_prefix, None)
    if tracked:
        ids = {id(x) for x in tracked}
        routes[:] = [x for x in routes if id(x) not in ids]
    else:
        routes[:] = [
            x for x in routes
            if not (getattr(x, "path", "") or "").startswith(api_prefix + "/")
            and (getattr(x, "path", "") or "") != api_prefix
        ]
    removed = before - len(routes)
    if removed:
        _bump_router_version()
    return removed


def _include(router, api_prefix: str) -> None:
    assert _app is not None
    before_ids = {id(x) for x in _app.router.routes}
    _app.include_router(router, prefix=api_prefix)
    _included_routes[api_prefix] = [x for x in _app.router.routes if id(x) not in before_ids]
    _bump_router_version()


def load_router(agent_key: str, router_path: str, api_prefix: str) -> bool:
    """ZIP 배포 후 라우터 파일을 런타임에 등록. 동일 prefix 기존 라우트는 교체."""
    if _app is None:
        logger.error("[addon_loader] app 미초기화")
        return False
    if not router_path:
        return False

    agent_dir = str(Path(router_path).parent)
    try:
        if agent_dir not in sys.path:
            sys.path.insert(0, agent_dir)  # `{agent_key}_lib` 서브패키지 import 지원
        mod_name = f"addon_{agent_key}"
        sys.modules.pop(mod_name, None)
        lib_prefix = f"{agent_key.replace('-', '_')}_lib"
        for m in [k for k in sys.modules if k == lib_prefix or k.startswith(lib_prefix + ".")]:
            sys.modules.pop(m, None)  # 재업로드 시 구버전 lib 캐시 제거
        # __pycache__ 를 거치지 않고 소스를 직접 컴파일 — 재업로드 시 크기·mtime 이 같은 파일의
        # 구버전 바이트코드가 재사용되는 문제 방지
        module = types.ModuleType(mod_name)
        module.__file__ = router_path
        sys.modules[mod_name] = module
        source = Path(router_path).read_text(encoding="utf-8")
        exec(compile(source, router_path, "exec"), module.__dict__)  # noqa: S102 — addon 코드 실행은 설계상 의도
        router = getattr(module, "router", None)
        if router is None:
            raise AttributeError(f"{router_path} 에 'router' 변수 없음")
        # 재업로드(force) 시 기존 라우트를 먼저 제거 — 미제거 시 옛 핸들러가 먼저 매칭됨
        _remove_routes(api_prefix)
        _include(router, api_prefix)
        _active_prefixes.add(api_prefix)
        logger.info("[addon_loader] loaded %s → %s", agent_key, api_prefix)
        return True
    except Exception as exc:  # noqa: BLE001
        logger.error("[addon_loader] %s 로드 실패: %s", agent_key, exc)
        return False


def unload_router(agent_key: str, api_prefix: str) -> None:
    """활성 prefix 제거 + 라우트 실제 제거 (D3 — 미들웨어 차단은 2차 방어)."""
    _active_prefixes.discard(api_prefix)
    removed = _remove_routes(api_prefix)
    sys.modules.pop(f"addon_{agent_key}", None)
    logger.info("[addon_loader] unloaded %s (%d route removed)", agent_key, removed)


def is_active_prefix(request_path: str) -> bool:
    """요청 경로가 활성 addon prefix에 속하는지 확인."""
    for prefix in _active_prefixes:
        if request_path == prefix or request_path.startswith(prefix + "/"):
            return True
    return False
