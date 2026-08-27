# Addon Agent 가이드 — SeCuardian-Basic

> **SeCuardian-Basic** 의 확장 모듈 시스템입니다.
> Agent 를 zip 패키지로 만들어 업로드하거나 SeCuardian-Marketplace 에서 설치하면,
> 앱 재시작 없이 API·DB·프론트가 즉시 배포(핫 디플로이)됩니다.

[English](README.en.md)

---

## 순수 코어 원칙 (SeCuardian-Basic)

Basic 저장소는 **Agent 패키지를 동봉하지 않습니다.**

- `zip/`·`deployed/` 는 **빈 디렉터리**(런타임 산출물 대상, git 미추적)입니다.
- 모든 Agent 는 (1) **SeCuardian-Marketplace 카탈로그 설치** 또는 (2) **ZIP 파일 업로드**로만 설치됩니다.
- 스캐폴딩 기준 템플릿(`_templates/` 5종)만 개발 편의를 위해 유지합니다.
- 보안 Agent 13종·worker 2종·내장 이식분은 **SeCuardian-Marketplace 자산**으로 관리됩니다.

---

## Agent 만들기 / 설치 방법

| 방법 | 설명 | 진입 |
|------|------|------|
| **마켓플레이스 설치** | SeCMP 카탈로그 조회 → 선택 → 설치 (sha256 검증) | 에이전트 관리 → 마켓플레이스 탭 |
| **스캐폴딩 Wizard** | 유형 선택 → 이름/설명 입력 → ZIP 자동 생성 (`POST /api/addon-agents/scaffold`) | 에이전트 관리 → 새 Agent 만들기 → 스캐폴딩 만들기 |
| **ZIP 업로드** | 직접 개발한 ZIP 업로드 (`POST /api/addon-agents/upload`) | 에이전트 관리 → 새 Agent 만들기 → ZIP 업로드 등록 |

---

## 디렉터리 구조

```
addon-agents/
├── Makefile                 개발 도우미 — make init/test/publish/clean
├── manifest.schema.json     매니페스트 v2 JSON Schema
├── _templates/              스캐폴딩 템플릿 5종 (+각 .zip 완성 패키지)
│   ├── Board/               app        — 게시판 + 댓글 (front 포함)
│   ├── RagAgent/            rag        — 문서 임베딩 + 벡터 검색 Q&A
│   ├── ServiceAgent/        service    — 백엔드 비즈니스 로직
│   ├── ToolProxyAgent/      tool-proxy — 외부 REST API 어댑터
│   └── UserManager/         app        — 사용자 관리 예제
├── zip/                     (비어 있음) 업로드 ZIP 보관 — 런타임 산출물
└── deployed/                (비어 있음) 설치된 Agent — 런타임 산출물
    └── {agent_key}/
        ├── {Name}-app.py
        ├── {Name}-front.tsx        (선택)
        ├── {Name}-sql.sql          (선택)
        ├── {Name}-meta.json        (필수)
        ├── {Name}-worker-guide.md  (worker.required=true 시)
        ├── {key}_lib/              (선택: 내부 파이썬 서브패키지)
        └── data/                   (선택: 샘플 → addon_data_dir 로 복사)
```

---

## 개발 절차 (Makefile)

`addon-agents/` 디렉터리에서 실행합니다.

```bash
cd addon-agents/

make init    AGENT=Survey   # Board 템플릿 복사 + 이름 치환 → _templates/Survey/ 생성
make test    AGENT=Survey   # 구조·문법·manifest v2·scan_zip 검증
make publish AGENT=Survey   # _templates/Survey.zip 패키징 (업로드 준비)
make clean   AGENT=Survey   # 생성 파일 삭제
```

`make test` 검증 항목:

| 검사 | 실패 시 |
|------|---------|
| `{Name}-app.py`·`{Name}-meta.json` 존재 | 실패 (meta.json 은 v2 필수) |
| Python 문법 (`py_compile`) | 실패 |
| `router = APIRouter(...)` export | 실패 |
| `from __future__ import` 사용 | 실패 (핫로드 소스 컴파일과 비호환) |
| `app.core.deps`/`app.db` 직접 import | **경고** — `app.addon_sdk` 사용 권장 (SeCMP 게시 심사 시 SDK-only) |
| manifest v2 스키마 (`uv run python -m app.services.addon_manifest`) | 실패 |
| SQL `CREATE TABLE` 구문 · front `export default` | 경고/실패 |
| zip 존재 시 `scan_zip` 정적 검증 | CRITICAL 차단 시 실패 |

---

## Addon SDK — `app.addon_sdk`

Addon 이 import 해도 되는 **유일한 공개 모듈**입니다 (`__sdk_version__ = "1.0.0"`, SemVer 하위호환 보장).

```python
from app.addon_sdk import (
    get_current_user, require_role,          # 인증/권한 (RBAC)
    fetch_all, fetch_one, execute_write, execute_insert,  # DB (raw SQL)
    PH, IS_SQLITE,                           # SQL placeholder · 방언 판별
    settings, BASE_DIR,                      # 설정 · 루트 경로
    call_llm,                                # async LLM 호출
    addon_data_dir, addon_file,              # 데이터/자원 경로 (CWD 비의존)
    norm_descriptions, parse_lang_map,       # 다국어 헬퍼
)
```

- 레거시 `from app.core.deps import ...`, `from app.db import _PH` 는 호환 shim 으로 **계속 동작**하지만
  `make test` 가 경고하며, SeCMP 게시 심사 시 SDK-only 를 권고합니다.
- **금지**: `app.services.<도메인>` import, 다른 Addon 파이썬 import.
  Agent 간 데이터 공유는 테이블(`tables_owned`) 또는 HTTP(`/api/addon/{other}/...`)로만.
- `from __future__ import annotations` 금지.

---

## 매니페스트 v2 — `{Name}-meta.json` (필수)

스키마: `manifest.schema.json` · 런타임 검증: `app/services/addon_manifest.py`
(검증 CLI: `uv run python -m app.services.addon_manifest <meta.json>`)

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

### 필드 표

| 필드 | 필수 | 설명 |
|------|:---:|------|
| `schema_version` | ✓ | `2` |
| `agent_key` | 권장 | `^[a-z][a-z0-9_-]{1,40}$`. 없으면 zip 파일명(stem) 소문자 |
| `display_name` / `description` | ✓ | 문자열 또는 `{ko,en,…}` dict (UI 언어별 표시, 폴백 지원) |
| `version` | ✓ | SemVer — 재업로드 시 버전 비교에 사용 |
| `agent_type` | ✓ | 아래 10종 표 참조 |
| `categories` | | 카탈로그 분류 (`security`, `utilities`, `template` 등) |
| `dependencies.python` | | pip 스펙 목록 — 설치 시 `uv pip install` 자동 실행 (`--dry-run` 선검사, `ADDON_DEPS_ALLOWLIST` 허용목록, `ADDON_DEPS_FIND_LINKS` 오프라인 wheel) |
| `requires.core` / `requires.sdk` | | 코어(`core_version=2.0.0`)/SDK(`1.0.0`) 최소 버전 |
| `requires.agents` | | 선행 Agent 키 목록 — 미충족 시 409 + 설치 순서 안내 |
| `tables_owned` | | Agent 소유 테이블 — **삭제 시 DROP 대상** |
| `required_env` | | 미설정 시 설치 경고 + UI 배너 (차단 아님) |
| `optional_env` | | 기능 향상 선택 환경변수 |
| `worker` | | `{required, kind: bundled\|external, name, version, package, guide}` — 외부 실작업 프로그램 선언 |
| `capabilities` | | `{verb, domain, description, input_schema, output_schema}` — Orchestrator capability 라우팅 |
| `governance` | | `isolation_required=true` 시 설치 확인 단계 + `required_env` 전량 필수 |
| `publisher` / `license` | | 게시자 · 라이선스 |

### agent_type (10종)

| agent_type | 용도 |
|------------|------|
| `app` | UI + CRUD 앱 (게시판, 설문 등) |
| `service` | 백엔드 비즈니스 로직 |
| `rag` | 문서 임베딩 + 벡터 검색 Q&A |
| `tool-proxy` | 외부 REST API → MCP 어댑터 |
| `reviewer` | 응답 품질·위험도 리뷰 게이트 |
| `execution` | 코드·명령 실행 Agent |
| `hitl` | Human-in-the-Loop 승인 게이트 |
| `memory` | 장기 메모리·컨텍스트 저장 |
| `federation` | 다른 Agent 시스템 연결 |
| `shell` | 셸 실행 Agent |

### 레거시 alias 자동 승격

v1 meta.json 도 로드 시 자동 승격됩니다:
`key→agent_key`, `type→agent_type`, `name→display_name`,
`min_platform_version→requires.core`, `db_tables→tables_owned`,
`dependencies`(list)→`dependencies.python`, `description`+`description_en`→lang dict.

---

## 파일 작성 가이드

### `{Name}-app.py`

- `router` 변수명으로 `APIRouter` 인스턴스 export — 마운트 경로: `/api/addon/{agent_key}/{prefix}/...`
- import 는 `app.addon_sdk` 만 사용

```python
from fastapi import APIRouter, Depends
from app.addon_sdk import PH, execute_insert, fetch_all, get_current_user

router = APIRouter(prefix="/items", tags=["myagent"])

@router.get("")
async def list_items(user: dict = Depends(get_current_user)):
    return {"items": await fetch_all("SELECT * FROM tbl_myagent_items WHERE NOT is_deleted")}
```

### `{Name}-sql.sql`

- SQLite/PostgreSQL 공통 문법 권장 (`CURRENT_TIMESTAMP`, `CREATE TABLE IF NOT EXISTS`), 테이블명 `tbl_` 접두사
- 방언 전용 문법(`SERIAL`/`NOW()` ↔ `AUTOINCREMENT`)은 업로드 시 로더가 자동 변환

### `{Name}-front.tsx`

- default export React 컴포넌트. import 는 `../../../api/client`(코어 axios 인스턴스)만 허용
- 독립형 i18n: `localStorage.getItem("locale")` + `localeChanged` 이벤트 구독
- 다크모드: Tailwind `dark:` 클래스. 본문 최상단 `<h1>` 에이전트명 금지(상단 헤더가 자동 표시) — 설명 한 줄만

---

## 설치 파이프라인 (업로드 / 마켓 공통)

```
ZIP → sha256 → scan_zip 정적 검증 (경로탐색·심링크·위험 모듈 AST — CRITICAL 차단)
→ manifest v2 로드 (레거시 alias 승격) → agent_key 검증
→ 중복 판정 (기존 키 409 duplicate — UI 확인 후 force 재요청)
→ requires.core/sdk/agents 검사 → dependencies.python 설치 (실패 시 롤백)
→ deployed/{key}/ 저장 → SQL 방언 정규화·strict 실행 (실패: 롤백 + 400 + 사유)
→ 라우터 핫로드 (_remove_routes 후 load_router)
→ tbl_addon_agents 기록 (version, checksum, manifest_json, installed_from, scan_result)
→ front.tsx → front/src/pages/addon/deployed/{key}.tsx → ADDON_WEB_REBUILD 전략
→ 응답에 worker 요약 + required_env 누락 경고
```

- 삭제·비활성·재업로드 시 라우터가 **실제 언로드**됩니다 (앱 재시작 불필요).
- 앱 재시작 시에는 DB 활성 Addon 을 조회해 모든 라우터를 자동 재등록합니다.

---

## API 엔드포인트

| Method | 경로 | 설명 | 권한 |
|--------|------|------|------|
| `GET` | `/api/addon-agents/` | 등록된 Addon 목록 | 로그인 |
| `POST` | `/api/addon-agents/upload` | ZIP 업로드 + 설치 파이프라인 | supervisor/admin |
| `POST` | `/api/addon-agents/scaffold` | 스캐폴딩 Wizard → ZIP 생성/즉시 배포 | supervisor/admin |
| `PATCH` | `/api/addon-agents/{key}/toggle` | 활성/비활성 토글 | supervisor/admin |
| `DELETE` | `/api/addon-agents/{key}` | Agent 삭제 (라우터 언로드 + `tables_owned` DROP) | supervisor/admin |
| `GET` | `/api/addon-agents/templates/list` | 템플릿 목록 | 로그인 |
| `GET` | `/api/addon-agents/templates/download/{name}` | 템플릿 zip 다운로드 | 로그인 |
| `GET` | `/api/addon-agents/{key}/worker-guide` | worker 설치 가이드 | 로그인 |
| `GET` | `/api/addon-agents/{key}/worker-package` | worker 배포 패키지 | 로그인 |
| `GET` | `/api/addon-agents/marketplace/config` | SeCMP 연결 설정 | supervisor/admin |
| `GET` | `/api/addon-agents/marketplace/catalog` | SeCMP 카탈로그 | supervisor/admin |
| `GET` | `/api/addon-agents/marketplace/download/{asset_key}` | 패키지 다운로드 (sha256 검증) | supervisor/admin |
| `POST` | `/api/addon-agents/marketplace/deploy` | 다운로드 + 설치 | supervisor/admin |

---

## Worker (외부 실작업 프로그램)

worker 설치가 필요한 Agent 는 `{Name}-worker-guide.md` 를 패키지에 내장하고 meta 에
`worker` 블록(`required` / `kind: bundled|external` / `guide`, bundled 는 `name`/`package`/`version`)을 선언합니다.
활성화 시 응답에 worker 요약이 포함되고 UI 가 가이드 모달을 띄우며,
`GET /api/addon-agents/{key}/worker-{guide,package}` 로 가이드·패키지를 제공합니다.
worker 소스를 저장소에 두는 경우 repo 루트의 `make worker-package` 로 `{Name}_worker.zip` 을 재생성합니다.

---

## 제약 및 주의사항

| 항목 | 내용 |
|------|------|
| 보안 | 업로드된 Python 은 API 프로세스에서 실행됨 — scan_zip CRITICAL 차단 + supervisor/admin 전용 설치 |
| 파일 크기 | zip 최대 10MB (`ADDON_MAX_ZIP_MB`) |
| 프론트 반영 | `ADDON_WEB_REBUILD=none(기본)\|compose\|webhook` — 기본값은 재빌드 없음 (docker.sock 미마운트) |
| 의존성 | `ADDON_DEPS_INSTALL`(기본 true) · `ADDON_DEPS_ALLOWLIST` · `ADDON_DEPS_FIND_LINKS` (config: `addon_deps_*`) |
| 격리 | `governance.isolation_required=true` Agent 는 설치 확인 단계 + `required_env` 전량 필수 |

---

_SeCuardian-Basic · Addon Agent Extension System_
