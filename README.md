# SeCuardian-Basic

> 보안 Multi-AI Agent **순수 코어 런타임 (Basic Edition)**
> "코어는 하나, 보안 Agent 는 마켓에서."

[English](README.en.md)

---

## 1. 제품 정의

SeCuardian-Basic 은 `SeCuardian` 의 코어(Orchestrator + AI 어시스턴트 + 인증/설정/MCP/A2A/Registry + Addon 핫디플로이)를 준용한 **배포용 기본판 보안 Multi-AI Agent 런타임**입니다.

- **순수 코어**: 런타임(`addon-agents/deployed/`)에 Agent 를 **미리 배포하지 않습니다.** (`addon-agents/zip/` 은 F18 독립 시험 벤치용 SeCMP ZIP 픽스처 — 자동 로드되지 않음) `app/` 에는 보안 스택(Wazuh·Falco·Keycloak·Vault 등) 참조가 0 입니다.
- **Agent 설치 경로는 두 가지뿐**:
  1. **SeCuardian-Marketplace(SeCMP) 카탈로그** 조회 → 설치 (`/agents` → 마켓플레이스 탭)
  2. **ZIP 파일 업로드** (`/agents` → ZIP 업로드 등록)
- **Addon SDK + 매니페스트 v2**: Addon 은 `app.addon_sdk` 공개 SDK 만 import 하고, `{Name}-meta.json`(manifest v2)으로 의존성·요구 코어 버전·worker·환경변수를 선언하는 독립 패키지입니다.
- 개발 편의를 위한 스캐폴딩 템플릿(`addon-agents/_templates/`) 6종만 저장소에 유지합니다.

| 항목 | 값 |
|------|-----|
| 앱 이름 | `SeCuardian-Basic` (`app/core/config.py: app_name`) |
| 코어 버전 | `2.0.0` (`core_version` — Addon `requires.core` 비교 대상) |
| SDK 버전 | `1.0.0` (`app/addon_sdk.py: __sdk_version__`) |
| 기본 포트 | Backend **8200** / Frontend **4200** |
| 유통 채널 | SeCuardian-Marketplace (SeCMP) |

---

## 2. 아키텍처

```
┌──────────────────────────── SeCuardian-Basic Instance ─────────────────────────────┐
│ front (Vite 7 + React 19, :4200)                                                    │
│   /chat /agents(카탈로그·ZIP·마켓플레이스) /users /settings /profile /setup          │
│   /addon/{key}  pages/addon/deployed/{key}.tsx ← Addon 프론트 (import.meta.glob)     │
│   api/client.ts ★ Addon 프론트가 import 가능한 유일 코어 모듈                        │
├────────────────────────────────────────────────────────────────────────────────────┤
│ api (FastAPI, :8200)                                                                 │
│   routers(14): auth users agent chat_history suggestions addon_agent llm settings   │
│                setup agent_config agent_registry a2a mcp mcp_config                 │
│   agents:  OrchestratorAgent (classify → gather → synthesize)                       │
│   addon_agent_loader: importlib 핫로드/언로드 ★ → /api/addon/{key}/...               │
│   addon_sdk ★  공개 SDK (deps·db·settings·llm·i18n·paths)                           │
│   services: llm_providers/llm_router/llm_metering/token_compress/llm_fallback        │
│             mcp_proxy_server openapi_to_mcp ollama_warmup                            │
│             addon_manifest ★ addon_validator ★ addon_deps ★                           │
│   core: config(BASE_DIR ★) deps security i18n                                        │
│   db.py: raw SQL, SQLite/PG 듀얼(PH), sql/{sqlite,pg}/*.sql 멱등 마이그레이션         │
├────────────────────────────────────────────────────────────────────────────────────┤
│ addon-agents/deployed/{key}/  {Name}-{app.py,front.tsx,sql.sql,meta.json}            │
│                               [{key}_lib/ 서브패키지 · data/ 허용]  — 런타임 산출물   │
├────────────────────────────────────────────────────────────────────────────────────┤
│ postgres17 | redis7.4 | ollama(cpu|gpu|mlx) | llamacpp | vllm                        │
└────────────────────────────────────────────────────────────────────────────────────┘
        ▲ catalog/download (HTTPS, sha256 검증)              ▲ worker API (외부 보안 스택)
┌───────┴────────────────┐                        ┌──────────┴────────────────┐
│ SeCuardian-Marketplace │                        │ 외부 보안 스택 / 타 인스턴스 │
│ /api/marketplace-host  │                        │ (A2A agent-card · MCP)      │
└────────────────────────┘                        └───────────────────────────┘
★ = Basic 신규/변경 지점
```

---

## 3. 기술 스택

| 레이어 | 기술 |
|--------|------|
| Backend | FastAPI ≥0.115 · Python 3.12 · uv · raw SQL (`app/db.py`, SQLite/PG 듀얼) · pydantic v2 |
| Frontend | Vite 7 · React 19 · TypeScript · Tailwind v4 · react-router 7 · TanStack Query 5 · i18n(ko/en/jp) |
| DB | SQLite (local) / PostgreSQL 17 (dev+) · Redis 7.4 |
| LLM | Anthropic(주) · OpenAI/Gemini(선택) · Ollama/llama.cpp/vLLM 로컬 provider 추상화 + Route/Metering/Token 압축 |
| Auth | JWT (python-jose) · bcrypt · TOTP · RBAC (supervisor/admin/user/viewer) |
| 프로토콜 | MCP (JSON-RPC 2.0, per-agent proxy) · A2A (agent-card) · Agent Registry |
| Addon | `addon_sdk` · `addon_manifest`(v2) · `addon_validator`(scan_zip) · `addon_deps`(uv pip) |
| 실행 | pm2 (local) · Docker Compose (dev/staging/prod) · `standalone/` |
| 품질 | ruff · pytest · GitHub Actions |

---

## 4. 빠른 시작 (Quickstart)

사전 요구사항: `uv`, `pnpm`, `pm2`, Docker (Ollama 컨테이너용, `OLLAMA_ENABLED=false` 면 생략 가능)

```bash
# 1. 클론
git clone <repo-url> SeCuardian-Basic && cd SeCuardian-Basic

# 2. 환경변수
cp .env.example .env.local
# .env.local 에서 ANTHROPIC_API_KEY 입력 (또는 로컬 LLM 전용이면 OLLAMA_* 확인)

# 3. 전체 기동 — SQLite + Ollama Docker(cpu) + BE/FE pm2
make local-all

# 4. 접속
#    Frontend  http://localhost:4200   → Setup Wizard(/setup): supervisor 계정 생성 · LLM provider 선택
#    Backend   http://localhost:8200   → GET /health

# 5. Agent 확인
#    /agents 에서 코어 Agent(Orchestrator, AI 어시스턴트)만 표시 — 보안 Agent 는 0개 (마켓에서 설치)
```

기타 실행/운영 타깃:

```bash
make up            # 인프라만 기동 (postgres + redis, ollama 는 OLLAMA_ENABLED=true·로컬 URL 일 때만)
make dev-be        # 백엔드만 (uvicorn --reload, :8200)
make dev-fe        # 프론트만 (pnpm dev, :4200)
make local-stop    # local 전체 중단
make local-logs    # pm2 로그
make dev-all       # dev 환경 (docker compose, .env.dev)
make db-fresh      # DB 초기화 + 기반 시드 (FORCE=1 로 확인 생략)
make lint          # ruff
```

포트는 `.env.<ENV>` 의 `BACKEND_PORT` / `FRONTEND_PORT` 로 변경할 수 있으며 기본값은 8200/4200 입니다.

---

## 5. Addon SDK (요약)

`app/addon_sdk.py` 는 Addon 이 import 해도 되는 **유일한 공개 모듈**입니다 (SemVer, `__sdk_version__ = "1.0.0"`).

```python
from app.addon_sdk import (
    get_current_user, require_role,            # 인증/RBAC
    fetch_all, fetch_one,                      # DB 조회
    execute_write, execute_insert,             # DB 쓰기
    PH, IS_SQLITE,                             # SQL placeholder · 방언 판별
    settings, BASE_DIR,                        # 설정 · 루트 경로
    call_llm,                                  # async LLM 호출 (provider 추상화)
    addon_data_dir, addon_file,                # 데이터/자원 경로 (CWD 비의존)
    norm_descriptions, parse_lang_map,         # i18n 헬퍼
)
```

- **호환 shim**: 기존 `from app.core.deps import ...`, `from app.db import _PH` 는 계속 동작합니다. 단 `addon-agents/ make test` 가 경고하며, SeCMP 게시 심사 시 SDK-only 를 권고합니다.
- **금지**: Addon → `app.services.<도메인>` import, Addon → 다른 Addon 파이썬 import. Agent 간 데이터 공유는 테이블(`tables_owned`) 또는 HTTP(`/api/addon/{other}/...`)로만.
- 프론트(`-front.tsx`)는 `../../../api/client` 만 import 할 수 있습니다.

## 6. Addon 매니페스트 v2 (요약)

패키지는 flat ZIP: `{Name}-app.py`(router export, `from __future__` 금지) · `{Name}-front.tsx`(선택) · `{Name}-sql.sql`(방언 중립 DDL, 선택) · `{Name}-meta.json`(**필수**) · `{Name}-worker-guide.md`(worker 필요 시) · `{key}_lib/` · `data/`.

`{Name}-meta.json` 주요 필드 (스키마: `addon-agents/manifest.schema.json`, 검증: `app/services/addon_manifest.py`):

| 필드 | 설명 |
|------|------|
| `schema_version` | `2` |
| `agent_key` | `^[a-z][a-z0-9_-]{1,40}$` — 없으면 zip 파일명(stem) 소문자 |
| `display_name` / `description` | 문자열 또는 `{ko,en,…}` dict |
| `version` | SemVer |
| `agent_type` | `app · service · tool-proxy · rag · reviewer · execution · hitl · memory · federation · shell` |
| `dependencies.python` | pip 패키지 목록 — 설치 시 `uv pip` 로 자동 설치 (허용목록·오프라인 wheel 지원) |
| `requires` | `{core, sdk, agents[]}` — 코어/SDK 버전, 선행 Agent |
| `tables_owned` | 소유 테이블 (삭제 시 DROP 대상) |
| `required_env` / `optional_env` | 미설정 시 경고 + UI 배너 (차단 아님) |
| `worker` | `{required, kind: bundled\|external, name, version, package, guide}` |
| `capabilities` / `governance` | capability 선언 · `isolation_required` 등 거버넌스 |
| `publisher` / `license` | 게시자 · 라이선스 |

레거시 alias (`key`→`agent_key`, `type`→`agent_type`, `min_platform_version`→`requires.core`, `db_tables`→`tables_owned`)는 로드 시 자동 승격됩니다. 상세 개발 가이드는 [addon-agents/README.md](addon-agents/README.md) 참조.

---

## 7. 마켓플레이스 설치 흐름

```
/settings 또는 .env 에 MARKETPLACE_BASE_URL(·API_KEY) 설정
→ /agents → "마켓플레이스" 탭 → 카탈로그 조회 → Agent 선택 → 설치
→ 서버 파이프라인:
   download → sha256 대조(MARKETPLACE_VERIFY_CHECKSUM)
   → scan_zip 정적 검증 (CRITICAL 차단)
   → manifest v2 로드 (레거시 alias 승격) → agent_key 검증
   → requires.core/sdk/agents 검사 → dependencies.python 설치 (실패 시 롤백)
   → SQL 방언 정규화·적용 → 라우터 핫로드 → tbl_addon_agents 기록
     (version, checksum, manifest_json, installed_from, scan_result)
→ 활성화 시 worker 요약 + Worker Guide 모달 → 외부 스택 연결
→ required_env 미설정 → 경고 배너, 해당 API 는 graceful 오류
```

관련 API:

| Method | 경로 | 설명 |
|--------|------|------|
| `GET` | `/api/addon-agents/marketplace/config` | 마켓 연결 설정 조회 |
| `GET` | `/api/addon-agents/marketplace/catalog` | SeCMP 카탈로그 조회 |
| `GET` | `/api/addon-agents/marketplace/download/{asset_key}` | 패키지 다운로드 (sha256 검증) |
| `POST` | `/api/addon-agents/marketplace/deploy` | 다운로드 + 설치 파이프라인 실행 |
| `POST` | `/api/addon-agents/upload` | ZIP 직접 업로드 (동일 파이프라인) |

환경변수: `MARKETPLACE_ENABLED` · `MARKETPLACE_HOST` · `MARKETPLACE_PORT` · `MARKETPLACE_BASE_URL` · `MARKETPLACE_API_KEY` · `MARKETPLACE_TLS_VERIFY` · `MARKETPLACE_VERIFY_CHECKSUM` (`.env.example` 참조)

---

## 8. 하드웨어 · 배치 모드

| 토폴로지 | 구성 | LLM | 적합 대상 |
|---|---|---|---|
| **T1. Cloud-API (기본)** | 단일 VM Docker Compose 또는 `make local-all` | Anthropic API(주) + Ollama CPU 폴백 | 데이터 반출 허용 SME |
| **T2. On-prem GPU** | `docker-compose.gpu.yml` + `OLLAMA_RUNTIME=gpu`, 또는 compose `vllm` profile | vLLM/Ollama 로컬(주) | 공공·금융·폐쇄망 |
| **T3. Apple Silicon** | `OLLAMA_RUNTIME=mlx` — Docker 는 Metal 불가, 호스트 네이티브 Ollama/MLX 구동 | MLX/Metal 가속 | PoC·현장 데모 |
| **T4. 폐쇄망 (Air-gap)** | `OLLAMA_ENABLED=false` 또는 로컬 전용 + `ADDON_DEPS_FIND_LINKS` 로컬 wheel 디렉터리, ZIP 반입 설치 | 로컬 전용 | 규제 산업 |

- 로컬 LLM 백엔드는 `LOCAL_LLM_PROVIDER=ollama|llamacpp|vllm` 으로 선택하며, compose 에 `llamacpp`(:8180)·`vllm`(:8100) profile 서비스가 포함되어 있습니다.
- 인바운드는 FE 4200(또는 리버스프록시)만 열고 API 8200·PG 5432·Redis 6379·Ollama 11434 는 내부망 권장.
- `api` 컨테이너는 docker.sock 을 마운트하지 않습니다 (`ADDON_WEB_REBUILD=none` 기본, `compose|webhook` 전략 선택 가능).

---

## 9. 디렉터리 구조

```
SeCuardian-Basic/
├── app/                    # FastAPI 백엔드
│   ├── main.py             #   앱 엔트리 (/health 포함)
│   ├── addon_sdk.py        # ★ Addon 공개 SDK
│   ├── addon_agent_loader.py # Addon 핫로드/언로드
│   ├── agents/             #   OrchestratorAgent · BaseAgent
│   ├── core/               #   config · deps · security · i18n
│   ├── routers/            #   코어 라우터 14종
│   ├── services/           #   LLM provider/route/metering · MCP proxy
│   │                       # ★ addon_manifest · addon_validator · addon_deps
│   └── db.py               #   raw SQL (SQLite/PG 듀얼)
├── addon-agents/
│   ├── _templates/         #   스캐폴딩 템플릿 6종 (Board·RagAgent·ServiceAgent·ShellAgent·ToolProxyAgent·UserManager)
│   ├── manifest.schema.json# ★ 매니페스트 v2 JSON Schema
│   ├── Makefile            #   make init/test/publish/clean
│   ├── deployed/           #   설치된 Agent (런타임 산출물 — git 미포함)
│   └── zip/                #   업로드 보관 (런타임 산출물 — git 미포함)
├── front/                  # Vite + React 19
├── sql/                    # {sqlite,pg} 멱등 마이그레이션
├── test/                   # dev-env + impl/ pytest
├── standalone/             # Agent 단독 실행 러너
├── deploy/                 # ansible · ci · docker(sonarqube)
├── docker-compose.yml      # postgres·redis·ollama(profile)·llamacpp·vllm·api·web
├── docker-compose.gpu.yml  # NVIDIA GPU 오버레이
└── Makefile
```

---

## 10. API 예시

```bash
# 헬스체크
curl http://localhost:8200/health

# Setup Wizard 상태 확인 (front /setup 이 사용)
curl http://localhost:8200/api/setup/status

# 로그인 → JWT
curl -X POST http://localhost:8200/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"<supervisor>","password":"<password>"}'

# 등록된 Addon 목록
curl -H "Authorization: Bearer $TOKEN" http://localhost:8200/api/addon-agents/

# Addon ZIP 업로드 (supervisor/admin)
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -F "file=@MyAgent.zip" http://localhost:8200/api/addon-agents/upload

# Addon 활성/비활성 토글 · 삭제
curl -X PATCH  -H "Authorization: Bearer $TOKEN" http://localhost:8200/api/addon-agents/myagent/toggle
curl -X DELETE -H "Authorization: Bearer $TOKEN" http://localhost:8200/api/addon-agents/myagent

# 마켓플레이스 카탈로그 조회 → 설치
curl -H "Authorization: Bearer $TOKEN" http://localhost:8200/api/addon-agents/marketplace/catalog
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"asset_key":"<key>"}' http://localhost:8200/api/addon-agents/marketplace/deploy
```

주요 환경변수 (`.env.example` 전체 목록 참조):

| 키 | 기본값 | 설명 |
|----|--------|------|
| `BACKEND_PORT` / `FRONTEND_PORT` | 8200 / 4200 | 서비스 포트 |
| `DATABASE_URL` | `sqlite:///./local.db` | local: SQLite / dev+: PostgreSQL |
| `ANTHROPIC_API_KEY` | — | Claude API (Cloud-API 모드) |
| `LOCAL_LLM_PROVIDER` | `ollama` | `ollama \| llamacpp \| vllm` |
| `OLLAMA_RUNTIME` | `cpu` | `cpu \| gpu \| mlx` |
| `OLLAMA_ENABLED` | `true` | `false` 면 Ollama Docker 컨테이너 기동·모델 pull 스킵 |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | 외부 서버 IP 지정 시(예: `http://192.168.8.243:11434`) Ollama 컨테이너 미기동. 컨테이너 내부에서 `localhost` 는 `host.docker.internal` 로 자동 치환 |
| `MARKETPLACE_BASE_URL` 등 | — | SeCMP 연결 (§7) |
| `ADDON_WEB_REBUILD` | `none` | Addon 프론트 재빌드 전략 `none \| compose \| webhook` |

---

## 11. 테스트

### 11.1 독립 시험 벤치 (F18) — 전 Agent 설치 매트릭스

SeCMP `marketplace-assets` 의 전 Agent ZIP(**50종** = security 34 · builtin 5 · utilities 5 · addon 6)이 `addon-agents/zip/` 에 시험 픽스처로 동봉됩니다. SeCMP 자산과 sha256 1:1 일치를 `test/impl/3rd_basic/` 이 검증합니다.

```bash
SB_TEST_INSTALL_DEPS=1 uv run python scripts/addon_matrix.py
# == 50 zips: 48 ok / 2 rejected(worker, 의도됨) / 0 fail
```

`missing_env` 경고는 외부 worker 스택 미연결 환경의 의도된 동작(503 graceful)입니다.

### 11.2 스캐폴드/Export 무의존 보장 (F19)

`/api/addon-agents/scaffold` 와 `/api/addon-agents/{key}/export` 산출 ZIP 은 독립 설치가 보장됩니다:
meta `agent_key` 새 이름 정합, `requires.agents=[]`, scaffold 는 `dependencies.python=[]`,
`-app.py` 는 `app.addon_sdk`(또는 shim `app.core.deps`/`app.db`)만 import — 위반 시 400 `not_independent`.
시험: `test/impl/2nd_basic/` (시나리오·결과 포함).


```bash
# 전체 pytest (make test = uv run pytest)
make test

# 구현 회귀 스위트만
uv run pytest test/impl
```

`test/impl/1st_basic/` 스위트: 코어 부팅(`test_01_core_boot`) · Addon 라이프사이클 업로드/토글/삭제/재업로드(`test_02_addon_lifecycle`) · manifest v2/레거시 alias(`test_03_manifest`) · 정적 검증·의존성 설치(`test_04_validator_deps`) · 마켓플레이스 ZIP 전량 설치(`test_05_marketplace_zip_install`).
`test/impl/3rd_basic/` 스위트: SeCMP 자산 동기(E9 신규 보안 7종 + E10 패키징 4종) — 픽스처 인벤토리·sha256 일치·신규 11종 설치·E10 worker-guide 서빙·`/status` 우아한 저하(`test_07_secmp_sync`).

---

## 12. SeCuardian 대비 변경점

SeCuardian(커밋 `9ce864d`)에서 파생하며 다음이 달라졌습니다.

- **보안 도메인 코어 분리**: 무조건 include 되던 **보안 라우터 26개 제거**, `core/{vault,vault_loader,keycloak,logto}.py`·`seed_security`·보안 Makefile 타깃·compose 보안 스택 URL 제거. `grep -ri "wazuh|keycloak|vault|falco" app/` = 0.
- **결함 D1~D15 수정**: CWD 상대경로 → `BASE_DIR` 절대경로화(D1), `sql_path` key 기준 재해석(D2), 라우터 실제 언로드(D3), `except: pass` 침묵 제거 → strict 표면화(D4), docker.sock 기본 제거·`ADDON_WEB_REBUILD` 전략화(D5), 포트 8200/4200 단일화(D7), 브랜딩 스윕(D8), 보안 라우터/seed 제거(D9), manifest 미검증 항목 검증화(D10), 템플릿 `_PH` 직접 import 제거(D11), scan_zip 도입(D12), meta `agent_key` 우선(D13), 잔여물 정리(D14) 등.
- **Addon SDK + 매니페스트 v2 + 정적 검증 + 의존성 자동 설치** 신설 (§5~§7).
- **`core_version` 2.0.0** — Addon `requires.core` 의 비교 대상.
- 보안 Agent 13종 + worker 2종 + 내장 이식분은 **SeCuardian-Marketplace 자산**으로 이동, 본 저장소는 순수 코어만 유지.

---

## 13. 문서

- PRD: [.docs/SeCuardian-Basic-PRD.md](.docs/SeCuardian-Basic-PRD.md)
- Addon 개발 가이드: [addon-agents/README.md](addon-agents/README.md)
- AI 코딩 표준: [AGENTS.md](AGENTS.md)
- 컴플라이언스: [COMPLIANCE.md](COMPLIANCE.md)

---

## Revision History

- **B3 (2026-09-10)**: SeCMP 자산 동기 — E9 신규 보안 Addon 7종(agentic-threat-model·attack-surface-recon·api-vuln-scan·cicd-security-scan·ad-security-scan·malware-hunt·soc-intel-fusion) + E10 패키징 4종(logto-monitor·istio-mtls·wireproxy-ztna·observability-monitor) 를 F18 픽스처에 편입(39→50종), 매트릭스 48 OK/2 REJECTED/0 FAIL. 결함 B3-1: E10 meta `worker.guide=null` 로 400 → 코어 manifest 가 null 문자열 필드를 `""` 로 수용 + 원본(SeCMP) 에 worker-guide.md 4종 추가·재패키징. SeCuardian `4129b9f`(B1/B2) 는 기반영 확인, SeCMP E11(governance)/E12(playground cost·eval) 및 SecuFTPL v0.4 는 Basic 코어 범위 외로 판정(PRD 변경 이력 참조).
- **B2 (2026-08-27)**: F18 독립 시험 벤치(전 Agent ZIP 39종 + `scripts/addon_matrix.py`), F19 스캐폴드/Export 무의존 보장(agent_key 정합, ShellAgent 템플릿 복원, `not_independent` 게이트). pytest 39/39.

| 버전 | 일자 | 내용 |
|------|------|------|
| **B1** | 2026-08-27 | SeCuardian 에서 파생 — 보안 코어 분리, SDK/manifest v2, 순수 코어화 |
