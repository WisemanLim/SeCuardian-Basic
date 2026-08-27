# Addon Agent Guide — SeCuardian-Basic

> The extension module system of **SeCuardian-Basic**.
> Package an agent as a zip and upload it, or install it from SeCuardian-Marketplace —
> its API, DB, and frontend are deployed immediately (hot deploy) without restarting the app.

[한국어](README.md)

---

## Pure-Core Principle (SeCuardian-Basic)

The Basic repository **ships no agent packages.**

- `zip/` and `deployed/` are **empty directories** (runtime output, not tracked by git).
- Every agent is installed only by (1) **SeCuardian-Marketplace catalog install** or (2) **ZIP file upload**.
- Only the scaffolding templates (`_templates/`, 5 kinds) remain for development convenience.
- The 13 security agents, 2 workers, and ported built-ins are managed as **SeCuardian-Marketplace assets**.

---

## How to Create / Install an Agent

| Method | Description | Entry |
|--------|-------------|-------|
| **Marketplace install** | browse the SeCMP catalog → pick → install (sha256 verified) | Agent Management → Marketplace tab |
| **Scaffolding Wizard** | pick a type → enter name/description → ZIP auto-generated (`POST /api/addon-agents/scaffold`) | Agent Management → New Agent → Scaffold |
| **ZIP upload** | upload a ZIP you developed (`POST /api/addon-agents/upload`) | Agent Management → New Agent → ZIP upload |

---

## Directory Layout

```
addon-agents/
├── Makefile                 dev helper — make init/test/publish/clean
├── manifest.schema.json     manifest v2 JSON Schema
├── _templates/              5 scaffolding templates (+ a finished .zip each)
│   ├── Board/               app        — board + comments (includes front)
│   ├── RagAgent/            rag        — document embedding + vector search Q&A
│   ├── ServiceAgent/        service    — backend business logic
│   ├── ToolProxyAgent/      tool-proxy — external REST API adapter
│   └── UserManager/         app        — user management example
├── zip/                     (empty) uploaded ZIP archive — runtime output
└── deployed/                (empty) installed agents — runtime output
    └── {agent_key}/
        ├── {Name}-app.py
        ├── {Name}-front.tsx        (optional)
        ├── {Name}-sql.sql          (optional)
        ├── {Name}-meta.json        (required)
        ├── {Name}-worker-guide.md  (when worker.required=true)
        ├── {key}_lib/              (optional: internal Python subpackage)
        └── data/                   (optional: samples → copied to addon_data_dir)
```

---

## Development Cycle (Makefile)

Run inside `addon-agents/`.

```bash
cd addon-agents/

make init    AGENT=Survey   # copy Board template + rename → _templates/Survey/
make test    AGENT=Survey   # structure · syntax · manifest v2 · scan_zip checks
make publish AGENT=Survey   # package _templates/Survey.zip (ready to upload)
make clean   AGENT=Survey   # delete generated files
```

What `make test` checks:

| Check | On failure |
|-------|------------|
| `{Name}-app.py` and `{Name}-meta.json` exist | fail (meta.json is mandatory in v2) |
| Python syntax (`py_compile`) | fail |
| `router = APIRouter(...)` export | fail |
| `from __future__ import` usage | fail (incompatible with hot-load source compilation) |
| direct `app.core.deps` / `app.db` imports | **warning** — use `app.addon_sdk` (SDK-only recommended for SeCMP publication) |
| manifest v2 schema (`uv run python -m app.services.addon_manifest`) | fail |
| SQL `CREATE TABLE` presence · front `export default` | warning/fail |
| `scan_zip` static validation when the zip exists | fail on CRITICAL block |

---

## Addon SDK — `app.addon_sdk`

The **only public module** an addon may import (`__sdk_version__ = "1.0.0"`, SemVer backward compatibility guaranteed).

```python
from app.addon_sdk import (
    get_current_user, require_role,          # auth / RBAC
    fetch_all, fetch_one, execute_write, execute_insert,  # DB (raw SQL)
    PH, IS_SQLITE,                           # SQL placeholder · dialect flag
    settings, BASE_DIR,                      # settings · project root
    call_llm,                                # async LLM call
    addon_data_dir, addon_file,              # data/resource paths (CWD-independent)
    norm_descriptions, parse_lang_map,       # i18n helpers
)
```

- Legacy `from app.core.deps import ...` and `from app.db import _PH` still work through compatibility shims,
  but `make test` warns about them and SDK-only imports are recommended for SeCMP publication review.
- **Forbidden**: importing `app.services.<domain>`, importing another addon's Python.
  Cross-agent data sharing goes through tables (`tables_owned`) or HTTP (`/api/addon/{other}/...`) only.
- `from __future__ import annotations` is forbidden.

---

## Manifest v2 — `{Name}-meta.json` (required)

Schema: `manifest.schema.json` · runtime validation: `app/services/addon_manifest.py`
(validation CLI: `uv run python -m app.services.addon_manifest <meta.json>`)

```json
{
  "schema_version": 2,
  "agent_key": "my-agent",
  "display_name": {"ko": "내 에이전트", "en": "My Agent"},
  "description":  {"ko": "...", "en": "..."},
  "version": "1.0.0",
  "agent_type": "service",
  "categories": ["utilities"],
  "dependencies": {"python": ["httpx>=0.27,<1"]},
  "requires": {"core": ">=1.0.0", "sdk": ">=1.0.0", "agents": []},
  "tables_owned": ["tbl_myagent_items"],
  "required_env": [], "optional_env": [],
  "worker": {"required": false},
  "capabilities": [{"verb": "process", "domain": "service.myagent", "description": "..."}],
  "governance": {"isolation_required": false},
  "publisher": "edentns", "license": "MIT"
}
```

### Field Table

| Field | Required | Description |
|-------|:---:|-------------|
| `schema_version` | ✓ | `2` |
| `agent_key` | recommended | `^[a-z][a-z0-9_-]{1,40}$`; falls back to lowercase zip stem |
| `display_name` / `description` | ✓ | string or `{ko,en,…}` dict (per-UI-language display with fallback) |
| `version` | ✓ | SemVer — used for version comparison on re-upload |
| `agent_type` | ✓ | one of the 10 types below |
| `categories` | | catalog classification (`security`, `utilities`, `template`, ...) |
| `dependencies.python` | | pip specs — auto-installed at install time via `uv pip install` (`--dry-run` pre-check, `ADDON_DEPS_ALLOWLIST`, offline wheels via `ADDON_DEPS_FIND_LINKS`) |
| `requires.core` / `requires.sdk` | | minimum core (`core_version=2.0.0`) / SDK (`1.0.0`) versions |
| `requires.agents` | | prerequisite agent keys — unmet → 409 + install-order guidance |
| `tables_owned` | | tables owned by the agent — **dropped on delete** |
| `required_env` | | missing values produce an install warning + UI banner (not a block) |
| `optional_env` | | optional enhancement variables |
| `worker` | | `{required, kind: bundled\|external, name, version, package, guide}` — external worker declaration |
| `capabilities` | | `{verb, domain, description, input_schema, output_schema}` — orchestrator capability routing |
| `governance` | | `isolation_required=true` adds an install confirmation step + makes all `required_env` mandatory |
| `publisher` / `license` | | publisher · license |

### agent_type (10 kinds)

| agent_type | Purpose |
|------------|---------|
| `app` | UI + CRUD app (board, survey, ...) |
| `service` | backend business logic |
| `rag` | document embedding + vector search Q&A |
| `tool-proxy` | external REST API → MCP adapter |
| `reviewer` | response quality/risk review gate |
| `execution` | code/command execution agent |
| `hitl` | Human-in-the-Loop approval gate |
| `memory` | long-term memory/context store |
| `federation` | connect other agent systems |
| `shell` | shell execution agent |

### Legacy Alias Auto-Promotion

v1 meta.json files are auto-promoted on load:
`key→agent_key`, `type→agent_type`, `name→display_name`,
`min_platform_version→requires.core`, `db_tables→tables_owned`,
`dependencies` (list) → `dependencies.python`, `description`+`description_en` → lang dict.

---

## File Authoring Guide

### `{Name}-app.py`

- Export an `APIRouter` instance named `router` — mounted at `/api/addon/{agent_key}/{prefix}/...`
- Import only from `app.addon_sdk`

```python
from fastapi import APIRouter, Depends
from app.addon_sdk import PH, execute_insert, fetch_all, get_current_user

router = APIRouter(prefix="/items", tags=["myagent"])

@router.get("")
async def list_items(user: dict = Depends(get_current_user)):
    return {"items": await fetch_all("SELECT * FROM tbl_myagent_items WHERE NOT is_deleted")}
```

### `{Name}-sql.sql`

- Prefer SQLite/PostgreSQL-common syntax (`CURRENT_TIMESTAMP`, `CREATE TABLE IF NOT EXISTS`); prefix tables with `tbl_`
- Dialect-specific syntax (`SERIAL`/`NOW()` ↔ `AUTOINCREMENT`) is auto-converted by the loader at upload time

### `{Name}-front.tsx`

- Default-export a React component. It may import only `../../../api/client` (the core axios instance)
- Standalone i18n: `localStorage.getItem("locale")` + subscribe to the `localeChanged` event
- Dark mode via Tailwind `dark:` classes. No agent-name `<h1>` at the top of the body (the header shows it automatically) — one description line only

---

## Install Pipeline (upload / marketplace shared)

```
ZIP → sha256 → scan_zip static validation (path traversal · symlinks · dangerous-module AST — CRITICAL blocks)
→ manifest v2 load (legacy alias promotion) → agent_key validation
→ duplicate check (existing key → 409 duplicate — retry with force after UI confirmation)
→ requires.core/sdk/agents checks → dependencies.python install (rollback on failure)
→ save to deployed/{key}/ → SQL dialect normalization · strict apply (failure: rollback + 400 + reason)
→ router hot load (_remove_routes then load_router)
→ tbl_addon_agents record (version, checksum, manifest_json, installed_from, scan_result)
→ front.tsx → front/src/pages/addon/deployed/{key}.tsx → ADDON_WEB_REBUILD strategy
→ response includes worker summary + missing required_env warnings
```

- On delete/deactivate/re-upload the router is **actually unloaded** (no app restart needed).
- On app restart, all routers of active addons are re-registered automatically from the DB.

---

## API Endpoints

| Method | Path | Description | Role |
|--------|------|-------------|------|
| `GET` | `/api/addon-agents/` | list registered addons | login |
| `POST` | `/api/addon-agents/upload` | ZIP upload + install pipeline | supervisor/admin |
| `POST` | `/api/addon-agents/scaffold` | scaffolding wizard → ZIP creation / immediate deploy | supervisor/admin |
| `PATCH` | `/api/addon-agents/{key}/toggle` | activate/deactivate | supervisor/admin |
| `DELETE` | `/api/addon-agents/{key}` | delete agent (router unload + drop `tables_owned`) | supervisor/admin |
| `GET` | `/api/addon-agents/templates/list` | template list | login |
| `GET` | `/api/addon-agents/templates/download/{name}` | template zip download | login |
| `GET` | `/api/addon-agents/{key}/worker-guide` | worker install guide | login |
| `GET` | `/api/addon-agents/{key}/worker-package` | worker deployment package | login |
| `GET` | `/api/addon-agents/marketplace/config` | SeCMP connection settings | supervisor/admin |
| `GET` | `/api/addon-agents/marketplace/catalog` | SeCMP catalog | supervisor/admin |
| `GET` | `/api/addon-agents/marketplace/download/{asset_key}` | package download (sha256 verified) | supervisor/admin |
| `POST` | `/api/addon-agents/marketplace/deploy` | download + install | supervisor/admin |

---

## Worker (external work program)

An agent that needs a worker embeds `{Name}-worker-guide.md` in its package and declares a
`worker` block in the meta (`required` / `kind: bundled|external` / `guide`; bundled also `name`/`package`/`version`).
On activation the response includes a worker summary and the UI shows a guide modal;
`GET /api/addon-agents/{key}/worker-{guide,package}` serves the guide and package.
If worker sources live in a repository, regenerate `{Name}_worker.zip` with `make worker-package` at the repo root.

---

## Constraints and Notes

| Item | Detail |
|------|--------|
| Security | uploaded Python runs inside the API process — scan_zip CRITICAL blocking + supervisor/admin-only installs |
| File size | zip max 10MB (`ADDON_MAX_ZIP_MB`) |
| Frontend rebuild | `ADDON_WEB_REBUILD=none (default)\|compose\|webhook` — default performs no rebuild (docker.sock not mounted) |
| Dependencies | `ADDON_DEPS_INSTALL` (default true) · `ADDON_DEPS_ALLOWLIST` · `ADDON_DEPS_FIND_LINKS` (config: `addon_deps_*`) |
| Isolation | agents with `governance.isolation_required=true` require an install confirmation step + all `required_env` set |

---

_SeCuardian-Basic · Addon Agent Extension System_
