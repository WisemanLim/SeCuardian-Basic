# AGENTS.md — SeCuardian-Basic

> AI 코딩 어시스턴트(Claude Code, Cursor 등)를 위한 프로젝트 표준 가이드

## 프로파일

```
wise-dev-standard / python-fastapi × ict-saas
파생 원본: SeCuardian (순수 코어 분리판 — 보안 Agent 는 SeCuardian-Marketplace 로 유통)
```

## 스택 요약

| 레이어 | 기술 |
|--------|------|
| Backend | FastAPI 0.115+ · Python 3.12 · uv · raw SQL (`app/db.py`, SQLite/PG 듀얼) |
| Frontend | Vite 7 + React 19 + TypeScript + Tailwind v4 · react-router v7 |
| DB | SQLite (local) / PostgreSQL 17 (dev+) + Redis 7.4 |
| LLM | Anthropic SDK (primary) · Ollama/llama.cpp/vLLM (로컬 provider 추상화) |
| Auth | JWT (python-jose) + bcrypt · TOTP · RBAC |
| AI 구조 | Orchestrator + BaseAgent + **Addon 핫디플로이 (addon_sdk · manifest v2)** |

## 확장 원칙 — 코어 수정 대신 Addon

도메인 기능 추가는 **코어(`app/`) 수정이 아니라 Addon 패키지 개발**이 기본입니다.

- Addon 은 `app.addon_sdk` 만 import 합니다 (공개 SDK, `__sdk_version__` SemVer 관리).
  제공 심볼: `get_current_user, require_role, fetch_all, fetch_one, execute_write,
  execute_insert, PH, IS_SQLITE, settings, BASE_DIR, call_llm, addon_data_dir,
  addon_file, norm_descriptions, parse_lang_map`
- 패키지 규격은 매니페스트 v2 (`{Name}-meta.json`, 스키마 `addon-agents/manifest.schema.json`).
- 개발 사이클: `cd addon-agents && make init AGENT=<Name> → make test → make publish`
  (검증: SDK-only import 경고 · manifest v2 · `from __future__` 금지 · scan_zip)
- 상세: `addon-agents/README.md`

## [CUSTOMIZE] 포인트 (코어 커스터마이징이 꼭 필요할 때만)

| 파일 | 수정 내용 |
|------|-----------|
| `app/agents/orchestrator.py` | `_VALID_INTENTS`, `_AGENT_MAP`, `_AGENT_LABELS` |
| `app/agents/base_agent.py` | `agent_key`, `get_system_prompt()`, DB 컨텍스트 주입 |
| `app/core/config.py` | `app_name`, 추가 설정값 |
| `app/main.py` | 도메인 라우터 추가 시 import (가능하면 Addon 으로) |
| `front/src/App.tsx` | 도메인 페이지/라우트 |
| `sql/{sqlite,pg}/01_init.sql` | 코어 테이블 변경 (Addon 테이블은 `{Name}-sql.sql` 로) |

## 개발 규칙

- 라우터: `app/routers/router_*.py` 패턴 준수. **보안 도메인 라우터를 코어에 추가하지 않는다** (Addon 으로)
- 의존성: `uv add` 사용 (`pip install` 직접 금지). Addon 의존성은 meta `dependencies.python` 선언
- 프론트 패키지: `pnpm add` 사용
- DB 마이그레이션: `sql/{sqlite,pg}/*.sql` 순번 추가 (모두 idempotent, 양 방언 동시 유지)
- 시험: `test/dev-env/` + `test/impl/<Nth>/` 구조 준수 (`uv run pytest test/impl`)
- 환경변수: `.env.local` 수정. `.env.prod` 는 키 목록만
- 코어 순수성: `grep -ri "wazuh\|keycloak\|vault\|falco" app/` 결과가 0 이어야 한다

## 참조

- PRD: `.docs/SeCuardian-Basic-PRD.md`
- Addon 개발 가이드: `addon-agents/README.md`
- 컴플라이언스: `COMPLIANCE.md`
