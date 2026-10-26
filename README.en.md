# SeCuardian-Basic

> Security Multi-AI Agent **pure core runtime (Basic Edition)**
> "One core, security agents from the marketplace."

[한국어](README.md)

---

## 1. Product Definition

SeCuardian-Basic is a **deployable Basic Edition security Multi-AI Agent runtime** that adopts the SeCuardian core (Orchestrator + AI Assistant + auth/settings/MCP/A2A/Registry + Addon hot-deploy).

- **Pure core**: no agents are pre-deployed at runtime (`addon-agents/deployed/`). (`addon-agents/zip/` holds SeCMP ZIP fixtures for the F18 standalone test bench — never auto-loaded.) `app/` contains zero references to security stacks (Wazuh, Falco, Keycloak, Vault, ...).
- **Only two ways to install agents**:
  1. **SeCuardian-Marketplace (SeCMP) catalog** browse → install (`/agents` → Marketplace tab)
  2. **ZIP file upload** (`/agents` → ZIP upload registration)
- **Addon SDK + manifest v2**: an addon imports only the public `app.addon_sdk` SDK and declares its dependencies, required core version, worker, and environment variables in `{Name}-meta.json` (manifest v2) as an independent package.
- Only the scaffolding templates (`addon-agents/_templates/`, 6 kinds) remain in the repository for development convenience.

| Item | Value |
|------|-------|
| App name | `SeCuardian-Basic` (`app/core/config.py: app_name`) |
| Core version | `2.0.0` (`core_version` — compared against addon `requires.core`) |
| SDK version | `1.0.0` (`app/addon_sdk.py: __sdk_version__`) |
| Default ports | Backend **8200** / Frontend **4200** |
| Distribution channel | SeCuardian-Marketplace (SeCMP) |

---

## 2. Architecture

```
┌──────────────────────────── SeCuardian-Basic Instance ─────────────────────────────┐
│ front (Vite 7 + React 19, :4200)                                                    │
│   /chat /agents(catalog·ZIP·marketplace) /users /settings /profile /setup           │
│   /addon/{key}  pages/addon/deployed/{key}.tsx ← addon frontends (import.meta.glob) │
│   api/client.ts ★ the only core module addon frontends may import                   │
├────────────────────────────────────────────────────────────────────────────────────┤
│ api (FastAPI, :8200)                                                                 │
│   routers(14): auth users agent chat_history suggestions addon_agent llm settings   │
│                setup agent_config agent_registry a2a mcp mcp_config                 │
│   agents:  OrchestratorAgent (classify → gather → synthesize)                       │
│   addon_agent_loader: importlib hot load/unload ★ → /api/addon/{key}/...            │
│   addon_sdk ★  public SDK (deps·db·settings·llm·i18n·paths)                         │
│   services: llm_providers/llm_router/llm_metering/token_compress/llm_fallback        │
│             mcp_proxy_server openapi_to_mcp ollama_warmup                            │
│             addon_manifest ★ addon_validator ★ addon_deps ★                           │
│   core: config(BASE_DIR ★) deps security i18n                                        │
│   db.py: raw SQL, SQLite/PG dual (PH), idempotent migrations in sql/{sqlite,pg}      │
├────────────────────────────────────────────────────────────────────────────────────┤
│ addon-agents/deployed/{key}/  {Name}-{app.py,front.tsx,sql.sql,meta.json}            │
│                               [{key}_lib/ subpackage · data/ allowed] — runtime only │
├────────────────────────────────────────────────────────────────────────────────────┤
│ postgres17 | redis7.4 | ollama(cpu|gpu|mlx) | llamacpp | vllm                        │
└──────────────────────────────────────────────────────────────────────────────────────┘
        ▲ catalog/download (HTTPS, sha256 verified)          ▲ worker API (external security stacks)
┌───────┴────────────────┐                        ┌──────────┴────────────────┐
│ SeCuardian-Marketplace │                        │ external stacks / peers    │
│ /api/marketplace-host  │                        │ (A2A agent-card · MCP)     │
└────────────────────────┘                        └───────────────────────────┘
★ = new/changed in Basic
```

---

## 3. Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | FastAPI ≥0.115 · Python 3.12 · uv · raw SQL (`app/db.py`, SQLite/PG dual) · pydantic v2 |
| Frontend | Vite 7 · React 19 · TypeScript · Tailwind v4 · react-router 7 · TanStack Query 5 · i18n (ko/en/jp) |
| DB | SQLite (local) / PostgreSQL 17 (dev+) · Redis 7.4 |
| LLM | Anthropic (primary) · OpenAI/Gemini (optional) · Ollama/llama.cpp/vLLM local provider abstraction + route/metering/token compression |
| Auth | JWT (python-jose) · bcrypt · TOTP · RBAC (supervisor/admin/user/viewer) |
| Protocols | MCP (JSON-RPC 2.0, per-agent proxy) · A2A (agent-card) · Agent Registry |
| Addon | `addon_sdk` · `addon_manifest` (v2) · `addon_validator` (scan_zip) · `addon_deps` (uv pip) |
| Runtime | pm2 (local) · Docker Compose (dev/staging/prod) · `standalone/` |
| Quality | ruff · pytest · GitHub Actions |

---

## 4. Quickstart

Prerequisites: `uv`, `pnpm`, `pm2`, Docker (for the Ollama container; skippable with `OLLAMA_ENABLED=false`)

```bash
# 1. Clone
git clone <repo-url> SeCuardian-Basic && cd SeCuardian-Basic

# 2. Environment
cp .env.example .env.local
# set ANTHROPIC_API_KEY in .env.local (or check OLLAMA_* for local-LLM-only mode)

# 3. Start everything — SQLite + Ollama Docker (cpu) + BE/FE via pm2
make local-all

# 4. Access
#    Frontend  http://localhost:4200   → Setup Wizard (/setup): create supervisor · pick LLM provider
#    Backend   http://localhost:8200   → GET /health

# 5. Check agents
#    /agents shows only the core agents (Orchestrator, AI Assistant) — zero security agents
#    (install them from the marketplace)
```

Other run/ops targets:

```bash
make up            # infra only (postgres + redis; ollama only when OLLAMA_ENABLED=true and the URL is local)
make dev-be        # backend only (uvicorn --reload, :8200)
make dev-fe        # frontend only (pnpm dev, :4200)
make local-stop    # stop local stack
make local-logs    # pm2 logs
make dev-all       # dev environment (docker compose, .env.dev)
make db-fresh      # reset DB + base seed (FORCE=1 skips confirmation)
make lint          # ruff
```

Ports are configurable via `BACKEND_PORT` / `FRONTEND_PORT` in `.env.<ENV>`; defaults are 8200/4200.

---

## 5. Addon SDK (summary)

`app/addon_sdk.py` is the **only public module** an addon may import (SemVer, `__sdk_version__ = "1.0.0"`).

```python
from app.addon_sdk import (
    get_current_user, require_role,            # auth / RBAC
    fetch_all, fetch_one,                      # DB reads
    execute_write, execute_insert,             # DB writes
    PH, IS_SQLITE,                             # SQL placeholder · dialect flag
    settings, BASE_DIR,                        # settings · project root
    call_llm,                                  # async LLM call (provider abstraction)
    addon_data_dir, addon_file,                # data/resource paths (CWD-independent)
    norm_descriptions, parse_lang_map,         # i18n helpers
)
```

- **Compatibility shims**: legacy `from app.core.deps import ...` and `from app.db import _PH` still work. `make test` in `addon-agents/` warns about them, and SDK-only imports are recommended for SeCMP publication review.
- **Forbidden**: addon → `app.services.<domain>` imports, addon → other addon Python imports. Cross-agent data sharing goes through tables (`tables_owned`) or HTTP (`/api/addon/{other}/...`) only.
- Frontends (`-front.tsx`) may import only `../../../api/client`.

## 6. Addon Manifest v2 (summary)

A package is a flat ZIP: `{Name}-app.py` (exports `router`, `from __future__` forbidden) · `{Name}-front.tsx` (optional) · `{Name}-sql.sql` (dialect-neutral DDL, optional) · `{Name}-meta.json` (**required**) · `{Name}-worker-guide.md` (when a worker is required) · `{key}_lib/` · `data/`.

Key `{Name}-meta.json` fields (schema: `addon-agents/manifest.schema.json`, validation: `app/services/addon_manifest.py`):

| Field | Description |
|-------|-------------|
| `schema_version` | `2` |
| `agent_key` | `^[a-z][a-z0-9_-]{1,40}$` — falls back to lowercase zip stem |
| `display_name` / `description` | string or `{ko,en,…}` dict |
| `version` | SemVer |
| `agent_type` | `app · service · tool-proxy · rag · reviewer · execution · hitl · memory · federation · shell` |
| `dependencies.python` | pip packages — auto-installed via `uv pip` at install time (allowlist, offline wheels supported) |
| `requires` | `{core, sdk, agents[]}` — core/SDK versions, prerequisite agents |
| `tables_owned` | owned tables (dropped on delete) |
| `required_env` / `optional_env` | missing values produce a warning + UI banner (not a block) |
| `worker` | `{required, kind: bundled\|external, name, version, package, guide}` |
| `capabilities` / `governance` | capability declarations · governance such as `isolation_required` |
| `publisher` / `license` | publisher · license |

Legacy aliases (`key`→`agent_key`, `type`→`agent_type`, `min_platform_version`→`requires.core`, `db_tables`→`tables_owned`) are auto-promoted on load. See [addon-agents/README.en.md](addon-agents/README.en.md) for the full development guide.

---

## 7. Marketplace Install Flow

```
Set MARKETPLACE_BASE_URL (· API_KEY) in /settings or .env
→ /agents → "Marketplace" tab → browse catalog → pick an agent → install
→ server pipeline:
   download → sha256 comparison (MARKETPLACE_VERIFY_CHECKSUM)
   → scan_zip static validation (CRITICAL blocks)
   → manifest v2 load (legacy alias promotion) → agent_key validation
   → requires.core/sdk/agents checks → dependencies.python install (rollback on failure)
   → SQL dialect normalization/apply → router hot load → tbl_addon_agents record
     (version, checksum, manifest_json, installed_from, scan_result)
→ on activation: worker summary + Worker Guide modal → connect external stack
→ missing required_env → warning banner; affected APIs fail gracefully
```

Related API:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/addon-agents/marketplace/config` | marketplace connection settings |
| `GET` | `/api/addon-agents/marketplace/catalog` | SeCMP catalog |
| `GET` | `/api/addon-agents/marketplace/download/{asset_key}` | package download (sha256 verified) |
| `POST` | `/api/addon-agents/marketplace/deploy` | download + install pipeline |
| `POST` | `/api/addon-agents/upload` | direct ZIP upload (same pipeline) |

Environment variables: `MARKETPLACE_ENABLED` · `MARKETPLACE_HOST` · `MARKETPLACE_PORT` · `MARKETPLACE_BASE_URL` · `MARKETPLACE_API_KEY` · `MARKETPLACE_TLS_VERIFY` · `MARKETPLACE_VERIFY_CHECKSUM` (see `.env.example`)

---

## 8. Hardware · Deployment Modes

| Topology | Setup | LLM | Fit |
|---|---|---|---|
| **T1. Cloud-API (default)** | single VM Docker Compose or `make local-all` | Anthropic API (primary) + Ollama CPU fallback | SMEs allowed to send data out |
| **T2. On-prem GPU** | `docker-compose.gpu.yml` + `OLLAMA_RUNTIME=gpu`, or the compose `vllm` profile | local vLLM/Ollama (primary) | public sector · finance · closed networks |
| **T3. Apple Silicon** | `OLLAMA_RUNTIME=mlx` — Docker has no Metal access; run native Ollama/MLX on the host | MLX/Metal acceleration | PoC · field demos |
| **T4. Air-gap** | `OLLAMA_ENABLED=false` or local-only + `ADDON_DEPS_FIND_LINKS` local wheel dir, ZIP-based installs | local only | regulated industries |

- Local LLM backend is selected with `LOCAL_LLM_PROVIDER=ollama|llamacpp|vllm`; compose includes `llamacpp` (:8180) and `vllm` (:8100) profile services.
- Expose only FE 4200 (or a reverse proxy) inbound; keep API 8200, PG 5432, Redis 6379, and Ollama 11434 internal.
- The `api` container does not mount docker.sock (`ADDON_WEB_REBUILD=none` by default; `compose|webhook` strategies available).

---

## 9. Directory Layout

```
SeCuardian-Basic/
├── app/                    # FastAPI backend
│   ├── main.py             #   app entry (incl. /health)
│   ├── addon_sdk.py        # ★ public addon SDK
│   ├── addon_agent_loader.py # addon hot load/unload
│   ├── agents/             #   OrchestratorAgent · BaseAgent
│   ├── core/               #   config · deps · security · i18n
│   ├── routers/            #   14 core routers
│   ├── services/           #   LLM provider/route/metering · MCP proxy
│   │                       # ★ addon_manifest · addon_validator · addon_deps
│   └── db.py               #   raw SQL (SQLite/PG dual)
├── addon-agents/
│   ├── _templates/         #   6 scaffolding templates (Board·RagAgent·ServiceAgent·ShellAgent·ToolProxyAgent·UserManager)
│   ├── manifest.schema.json# ★ manifest v2 JSON Schema
│   ├── Makefile            #   make init/test/publish/clean
│   ├── deployed/           #   installed agents (runtime output — not in git)
│   └── zip/                #   upload archive (runtime output — not in git)
├── front/                  # Vite + React 19
├── sql/                    # idempotent migrations for {sqlite,pg}
├── test/                   # dev-env + impl/ pytest
├── standalone/             # single-agent runner
├── deploy/                 # ansible · ci · docker (sonarqube)
├── docker-compose.yml      # postgres·redis·ollama(profile)·llamacpp·vllm·api·web
├── docker-compose.gpu.yml  # NVIDIA GPU overlay
└── Makefile
```

---

## 10. API Examples

```bash
# Health check
curl http://localhost:8200/health

# Setup Wizard status (used by the front /setup page)
curl http://localhost:8200/api/setup/status

# Login → JWT
curl -X POST http://localhost:8200/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"<supervisor>","password":"<password>"}'

# List registered addons
curl -H "Authorization: Bearer $TOKEN" http://localhost:8200/api/addon-agents/

# Upload an addon ZIP (supervisor/admin)
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -F "file=@MyAgent.zip" http://localhost:8200/api/addon-agents/upload

# Toggle / delete an addon
curl -X PATCH  -H "Authorization: Bearer $TOKEN" http://localhost:8200/api/addon-agents/myagent/toggle
curl -X DELETE -H "Authorization: Bearer $TOKEN" http://localhost:8200/api/addon-agents/myagent

# Browse the marketplace catalog → install
curl -H "Authorization: Bearer $TOKEN" http://localhost:8200/api/addon-agents/marketplace/catalog
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"asset_key":"<key>"}' http://localhost:8200/api/addon-agents/marketplace/deploy
```

Key environment variables (full list in `.env.example`):

| Key | Default | Description |
|-----|---------|-------------|
| `BACKEND_PORT` / `FRONTEND_PORT` | 8200 / 4200 | service ports |
| `DATABASE_URL` | `sqlite:///./local.db` | local: SQLite / dev+: PostgreSQL |
| `ANTHROPIC_API_KEY` | — | Claude API (Cloud-API mode) |
| `LOCAL_LLM_PROVIDER` | `ollama` | `ollama \| llamacpp \| vllm` |
| `OLLAMA_RUNTIME` | `cpu` | `cpu \| gpu \| mlx` |
| `OLLAMA_ENABLED` | `true` | `false` skips starting the Ollama Docker container and pulling models |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | an external server address (e.g. `http://192.168.8.243:11434`) means no Ollama container is started. Inside containers `localhost` is auto-rewritten to `host.docker.internal` |
| `MARKETPLACE_BASE_URL` etc. | — | SeCMP connection (§7) |
| `ADDON_WEB_REBUILD` | `none` | addon frontend rebuild strategy `none \| compose \| webhook` |

---

## 11. Testing

### 11.1 Standalone test bench (F18) — full agent install matrix

All **50** agent ZIPs from SeCMP `marketplace-assets` (security 34 · builtin 5 · utilities 5 · addon 6) are bundled under `addon-agents/zip/` as test fixtures. `test/impl/3rd_basic/` verifies a 1:1 sha256 match with the SeCMP assets.

```bash
SB_TEST_INSTALL_DEPS=1 uv run python scripts/addon_matrix.py
# == 50 zips: 48 ok / 2 rejected (workers, by design) / 0 fail
```

`missing_env` warnings are the intended behavior (graceful 503) when external worker stacks are not connected.

### 11.2 Scaffold/Export independence guarantee (F19)

ZIPs produced by `/api/addon-agents/scaffold` and `/api/addon-agents/{key}/export` are guaranteed standalone:
meta `agent_key` matches the new name, `requires.agents=[]`, scaffolds have `dependencies.python=[]`,
and `-app.py` may only import `app.addon_sdk` (or the shims `app.core.deps` / `app.db`) — violations are rejected with 400 `not_independent`.
Tests: `test/impl/2nd_basic/`.


```bash
# full pytest (make test = uv run pytest)
make test

# implementation regression suite only
uv run pytest test/impl
```

The `test/impl/1st_basic/` suite covers: core boot (`test_01_core_boot`), addon lifecycle upload/toggle/delete/re-upload (`test_02_addon_lifecycle`), manifest v2 + legacy aliases (`test_03_manifest`), static validation + dependency install (`test_04_validator_deps`), and full marketplace ZIP installation (`test_05_marketplace_zip_install`).

---

## 12. Changes vs SeCuardian

Derived from SeCuardian (commit `9ce864d`), with the following differences:

- **Security domain separated from the core**: the **26 unconditionally included security routers were removed**, along with `core/{vault,vault_loader,keycloak,logto}.py`, `seed_security`, security Makefile targets, and hardcoded security stack URLs in compose. `grep -ri "wazuh|keycloak|vault|falco" app/` = 0.
- **Defects D1–D15 fixed**: CWD-relative paths → absolute `BASE_DIR` (D1), `sql_path` re-resolved by key (D2), real router unload (D3), silent `except: pass` removed → strict surfacing (D4), docker.sock removed by default + `ADDON_WEB_REBUILD` strategy (D5), ports unified to 8200/4200 (D7), branding sweep (D8), security routers/seed removed (D9), previously unvalidated manifest fields now validated (D10), template direct `_PH` imports removed (D11), scan_zip introduced (D12), meta `agent_key` takes precedence (D13), leftover artifacts cleaned (D14), etc.
- **New: Addon SDK + manifest v2 + static validation + automatic dependency install** (§5–§7).
- **`core_version` 2.0.0** — the comparison target for addon `requires.core`.
- The 13 security addons + 2 workers + ported built-ins moved to **SeCuardian-Marketplace assets**; this repository keeps only the pure core.

---

## 13. Documents

- PRD: [.docs/SeCuardian-Basic-PRD.md](.docs/SeCuardian-Basic-PRD.md)
- Addon development guide: [addon-agents/README.en.md](addon-agents/README.en.md)
- AI coding standard: [AGENTS.md](AGENTS.md)
- Compliance: [COMPLIANCE.md](COMPLIANCE.md)

---

## Revision History

- **B3 (2026-09-10)**: SeCMP asset sync — 7 new E9 security addons (agentic-threat-model, attack-surface-recon, api-vuln-scan, cicd-security-scan, ad-security-scan, malware-hunt, soc-intel-fusion) + 4 E10 packaged addons (logto-monitor, istio-mtls, wireproxy-ztna, observability-monitor) added to the F18 fixtures (39→50); matrix 48 OK / 2 REJECTED / 0 FAIL. Defect B3-1: E10 metas shipped `worker.guide=null` → 400; core manifest now coerces null string fields to `""`, and the origin (SeCMP) assets gained 4 worker-guide.md files and were repackaged. SeCuardian `4129b9f` (B1/B2) confirmed already applied; SeCMP E11 (governance) / E12 (playground cost·eval) and SecuFTPL v0.4 judged outside Basic core scope (see PRD change log). New suite `test/impl/3rd_basic/`.
- **B2 (2026-08-27)**: F18 standalone test bench (39 agent ZIPs + `scripts/addon_matrix.py`), F19 scaffold/export independence guarantee (agent_key consistency, ShellAgent template restored, `not_independent` gate). pytest 39/39.

| Version | Date | Changes |
|---------|------|---------|
| **B1** | 2026-08-27 | Derived from SeCuardian — security core separation, SDK/manifest v2, pure-core refactor |
