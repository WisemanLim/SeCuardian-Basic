# PRD: SeCuardian-Basic — Security Multi-AI Agent System (Basic Edition)

> 업종 오버레이: `ict-saas` (KSIC J) + `govtech` 델타(SeCMP 준용) — 출처: `wise-dev-standard/domains/ict-saas.yaml`
> 작성일: 2026-08-27 / v0.1 (초안) / 작성: bclim@edentns.com (Claude Code 보조)
> 기준 구현: `SeCuardian` (커밋 `9ce864d`, 2026-08-12) · 유통 채널: `SeCuardian-Marketplace`(SeCMP) · 선행 사례: `MAS-Basic`(2026-08-27)
> 참고 자료: [SeCuardian-Basic-Survey.md](SeCuardian-Basic-Survey.md) (기술·시장 동향 조사)
> 설문(Why·Who·What·How·Success)은 비대화형 세션이라 요청문에서 도출했고, 추정값은 `가정:` 으로 표시한다.

---

# Part A. One-Page PRD

## 1. 개요

- **한 줄 요약**: `SeCuardian` 의 코어(Orchestrator + AI Assistant + 인증/설정/MCP/A2A/Registry + Addon 핫디플로이)를 **100% 준용**한 **배포용 기본판(Basic Edition) 보안 Multi-AI Agent 런타임**. 보안 도메인 기능은 코어에 내장하지 않고, **SeCuardian-Marketplace 에서 유통되는 Addon Agent(보안 13종 + 유틸리티/템플릿)** 를 설치하여 확장한다. "코어는 하나, 보안 Agent 는 마켓에서."
- **배경 / 왜 지금**: SeCuardian 은 `MultiAIAgent-Template`/`Wise-MultiAIAgent-Template` 를 100% 준용해 결함을 줄이고 보안 필수 Agent(내장 9종 + Addon 13종)를 갖췄다. 그러나 (a) 보안 라우터 26개가 `app/main.py` 에 무조건 include 되어 인스턴스마다 전체 보안 스택(Keycloak·Vault·Wazuh·Falco…) URL 과 60+ Makefile 타깃을 끌고 다니고, (b) `make seed-security` 로 시드된 키는 동일 키 Addon 업로드를 409 `builtin_conflict` 로 막아 **마켓플레이스 배포판으로 갱신할 수 없으며**, (c) Addon 이 `app.db._PH` 같은 비공개 심볼·3세대 혼재 meta.json·미검증 `dependencies` 에 의존해 **독립 패키지로서의 계약이 없다**. SeCuardian-Basic 은 "설치형 코어 + 마켓 배포 Agent" 모델을 성립시키는 기준 런타임이다.

## 2. 문제와 대상 (Why & Who)

- **핵심 문제** (근거: 감사 보고서 2026-08-27, `SeCuardian` 정적 분석 + Addon 21종 import 실측)
  1. **코어/도메인 미분리** — 보안 라우터 26개 무조건 include(`app/main.py:143-171`), compose 에 13개 보안 스택 URL 하드코딩, config 에 caddy/teleport/dfir/isms 필드 상주 → 고객사 환경마다 불필요 의존성·설정 노출.
  2. **Addon 독립성 부재** — 템플릿 4종이 `from app.db import _PH`(비공개), 13종 meta.json 이 `key/type`·`agent_key/agent_type`·lang-dict 3세대 혼재, `dependencies`/`min_platform_version`/`required_env` 는 저장만 하고 미검증(pip 미설치), `sql_path` 상대경로 저장, 라우터 언로드 불가(삭제 후 "재시작 필요"), `except: pass` 8곳으로 실패 침묵.
  3. **유통 계약 불완전** — SeCMP host 는 `catalog/download + sha256` 만 제공. 서명·버전 협상·manifest 스키마 검증 없음. 인스턴스 측(seed-security) 정책이 마켓 갱신을 차단.
  4. **외부 worker 의존** — 보안 Addon 13종은 전부 외부 시스템 프록시(Wazuh/Falco/Teleport…)로 worker 부재 시 503/빈 목록. 설치는 되지만 "동작 조건" 이 패키지에 선언·검증되지 않는다(worker guide 는 12종, isms-p-evidence 는 부재).
- **비즈니스 중요성**: 고객사마다 SeCuardian 전체를 fork·커스터마이즈하는 대신 **Basic 1회 설치(on-prem/cloud/hybrid) + SeCMP 에서 필요한 보안 Agent 선택 설치**로 납품 리드타임 단축, Agent 단위 판매·업데이트 배포(SeCMP 사업모델 전제) 성립. 가정: 프로젝트당 코어 재수정 공수 1~2주 절감(MAS-Basic PRD 가정치 준용).
- **근거 데이터 / VOC**: 감사 결과 — A 결함 15건(D1~D15), SeCMP 갭 7건, Addon 21종 중 C(MAS-Basic) 매니페스트 검증 실패 21/21(lang-dict·하이픈 키), `_PH` 결합 4종, `make seed-security` 후 13종 업로드 409.
- **타깃 사용자**
  - **플랫폼 운영자(supervisor/admin)**: Basic 을 고객 환경에 설치·운영, SeCMP 카탈로그에서 보안 Agent 설치/업데이트, worker 설치 가이드 따라 외부 스택 연결.
  - **보안 Agent 개발자**: Addon SDK + 매니페스트 v2 로 독립 패키지 제작 → SeCMP 게시.
  - **최종 사용자(user/viewer)**: 채팅 UI·Agent 전용 화면(SOC 운영자·감사 담당).
- **대표 사용 상황**: 폐쇄망 공공/금융 고객이 Basic 을 온프렘 GPU 서버에 설치하고 SeCMP(사내 host 또는 airgap 반입)에서 `wazuh-siem`·`velociraptor-dfir`·`isms-p-evidence` 만 설치, 로컬 LLM(vLLM/Ollama)으로 운영.

## 3. 범위 (What — In / Out)

### In Scope

| 우선순위 | 기능 | 비고 |
|---|---|---|
| P0 | **F1. 코어 런타임 = SeCuardian 100% 준용(코어 14 라우터)** — auth, users, agent(SSE), chat_history, suggestions, addon_agent, llm(provider/route/metering), settings, setup, agent_config, agent_registry, a2a, mcp, mcp_config + Orchestrator + 13 테이블 + Local LLM 다양화(R19) + 다국어(R18-7/R20-5) + Worker 동봉(R22) + 중복확인 일원화(R22-7) | 파일 구조·API 경로·DB 스키마·`front/src/api/client` 경로 그대로. 브랜딩만 `SeCuardian-Basic` |
| P0 | **F2. 보안 도메인 코어 분리** — 보안 라우터 26개·`scripts/seed_security.py`·Makefile 보안 타깃 60+·compose 보안 URL·`core/{vault,vault_loader,keycloak,logto}.py`·`hvac` 의존 제거. 내장 9종(keycloak-monitor 등)은 **Addon 패키지로 재구성**하여 SeCMP `security/` 카테고리에 추가 | 코어 `app/` 은 보안 스택을 모른다 |
| P0 | **F3. 알려진 결함 15건 수정(D1~D15)** — `BASE_DIR` 절대경로화, `sql_path` key 기준 재해석, 라우터 실제 언로드(`_remove_routes`+버전 bump), `except: pass` → strict 표면화, 포트 단일화(8200/4200), docker.sock 기본 제거·`ADDON_WEB_REBUILD` 전략화, `_kill_port` 범위 제한, 잔여물(.omc/.DS_Store/local.db) 정리 | §B-6 대응표 |
| P0 | **F4. Addon SDK (`app/addon_sdk.py`) — 공개 안정 인터페이스** — `get_current_user, require_role, fetch_all, fetch_one, execute_write, execute_insert, PH, IS_SQLITE, settings, BASE_DIR, call_llm, addon_data_dir, addon_file, norm_descriptions, parse_lang_map, __sdk_version__`. 기존 `from app.core.deps` / `from app.db import _PH` import 는 **호환 shim 으로 계속 동작** | MAS-Basic `addon_sdk.py` 포팅 + i18n 헬퍼 추가 |
| P0 | **F5. Addon 매니페스트 v2 (`{Name}-meta.json`, SeCuardian 방언)** — `schema_version, agent_key(하이픈 허용 `^[a-z][a-z0-9_-]{1,40}$`), display_name/description(str **또는** `{ko,en,…}` dict), version(semver), agent_type(10종), categories[], dependencies.python[], requires{core,sdk,agents[]}, tables_owned[], permissions[], worker{required,kind,name,version,package,guide}, required_env[], optional_env[], capabilities[], governance{}, publisher, license`. 레거시 alias `key→agent_key`, `type→agent_type`, `min_platform_version→requires.core` 자동 승격. `addon-agents/manifest.schema.json` + pydantic 검증 | SeCMP 와 스키마 공유(SeCMP 측 요구사항으로 전달) |
| P0 | **F6. Addon 의존성 설치** — 업로드/마켓 설치 시 `dependencies.python` 을 `uv pip install --python <venv>` 로 설치(허용목록·버전 핀·오프라인 `ADDON_DEPS_FIND_LINKS` wheel 디렉터리·`--dry-run` 충돌 검사). 실패 시 설치 거부 + 사유. `required_env` 미설정은 **경고 + 활성화 시 UI 배너**(차단 아님) | MAS-Basic `addon_deps.py` 포팅 |
| P0 | **F7. 기존 Agent 전량 설치 가능(저장소 미동봉)** — Basic 저장소는 Agent 를 동봉하지 않는다(순수 코어, 스캐폴드용 `_templates` 만 유지). SeCMP `marketplace-assets/security` 의 보안 Addon 13종 + 내장→Addon 이식 8종(본 프로젝트에서 SeCMP 자산으로 추가) + 템플릿 5종을 **SeCMP 카탈로그 설치 또는 ZIP 업로드 경로로** 클린 Basic 인스턴스에 설치하여 부팅·API smoke 정상. worker 2종은 `kind=worker` 다운로드 전용 | §B-5 이식 매트릭스 |
| P0 | **F8. 정적 검증 파이프라인** — `scan_zip`(경로탐색·심링크·zip bomb·확장자 화이트리스트·위험 모듈/호출 AST 스캔, CRITICAL 차단/WARNING 기록) + sha256 기록(`tbl_addon_agents.checksum`) + `scan_result` 저장. worker 패키지는 바이너리 허용 별도 정책 | MAS-Basic `addon_validator.py` 포팅 |
| P1 | **F9. SeCMP 클라이언트 유지·강화** — 기존 `/api/addon-agents/marketplace/{config,catalog,deploy,download}`(SeCMP host 호환, sha256 검증) 유지 + `updates`(설치본 vs 카탈로그 version 비교) + `requires.agents` 순서 안내 + 설치 이력(`installed_from=marketplace:<url>`) | SeCMP 측 `signature` 필드·manifest 검증은 요구사항 전달(본 PRD 범위 외) |
| P1 | **F10. 프론트 Addon 배포 분리** — `ADDON_FRONT_DEPLOYED_PATH` 주입, `ADDON_WEB_REBUILD=none\|compose\|webhook`. 기본 `none`(docker.sock 미마운트) | K8s/분리 배포 대응 |
| P1 | **F11. 하드웨어 프로파일** — `OLLAMA_RUNTIME=cpu\|gpu\|mlx`(R19 유지) + `LLM_PROVIDER=anthropic\|ollama\|llamacpp\|vllm` + compose 오버레이 `gpu.yml`/`mlx.yml`(MAS-Basic 이식) + 폐쇄망(`OLLAMA_ENABLED=false`, `ADDON_DEPS_FIND_LINKS`) | §B-3 |
| P1 | **F12. pytest 회귀 스위트** — 부팅/마이그레이션/업로드·토글·삭제·재업로드(언로드 검증)/SDK 계약/manifest v2·레거시 alias/deps/scan/27종 설치 시나리오 (`test/impl/<N>th/`) | MAS-Basic test_01~05 이식 |
| P1 | **F13. 문서** — README(ko/en)·`addon-agents/README`·AGENTS.md·COMPLIANCE.md·`.docs/guides` 를 Basic 기준으로 현행화, "SeCuardian → Basic + SeCMP" 이행 가이드 | |
| P2 | **F14. 운영 하드닝** — JWT 블랙리스트·A2A 태스크·MCP 상태 Redis 이전, `tbl_audit_log` 에 addon.install/toggle/delete 실기록, OTel 훅 | ict-saas NFR |
| P2 | **F15. Helm 차트 실물**(`deploy/helm/`) + K8s 매니페스트, `deploy/{ansible,systemd}` 검증 | |
| P2 | **F16. Addon 서명(Ed25519/GPG) 검증** — SeCMP `services/signature.py` 대칭 클라이언트 + 게시자 키 관리 | SeCMP 연동 |
| P0 | **F18. 독립 시험 벤치** — SeCMP `marketplace-assets` 전 Agent ZIP(39종)을 `addon-agents/zip/` 에 **시험 픽스처로 동봉**하고, `scripts/addon_matrix.py` 로 전량 설치 매트릭스(OK/REJECTED/FAIL + missing_env) 를 진단. 오류 발견 시 원본(SeCuardian/SeCMP 자산)을 수정·재패키징 | 순수 코어 원칙 유지: deployed/ 는 여전히 비어 있고 zip/ 은 시험 원본일 뿐 자동 로드되지 않음 |
| P0 | **F19. 스캐폴드/Export ZIP 무의존 보장** — `/scaffold` 와 `/{key}/export` 산출 ZIP 은 (a) meta `agent_key` 를 새 이름 소문자로 정확히 갱신(설치 키 불일치 방지), (b) `requires.agents=[]` 강제(scaffold 는 `dependencies.python=[]`, export 는 자체 선언 유지 — 매니페스트만으로 설치 완결), (c) `-app.py` 의 코어 import 는 `app.addon_sdk`(또는 호환 shim) 만 허용 — 위반 시 생성 거부. `shell` 유형 템플릿(ShellAgent) 복원 | 독립 설치 가능한 ZIP 만 생성 |
| P2 | **F17. Agent-type Addon** — `{Name}-agent.py` 로 `BaseAgent` 서브클래스 등록(MAS-Basic 규격). SeCuardian 은 BaseAgent 서브클래스 0 이므로 규격만 수용 | |

### Out of Scope

- 보안 도메인 신규 Agent 개발(기존 27종 이식·정규화만; 신규는 SeCMP 프로젝트/`extra-agents` 로드맵 소관)
- SeCMP 서버 측 기능(카탈로그 UI, org/tenant, 서명 노출, manifest 검증, Workflow/RAG/Guardrails) — 요구사항만 전달
- Addon **런타임 샌드박스**(프로세스/컨테이너 격리) — 정적 검증까지. Open Question 유지
- 외부 보안 스택(Wazuh·Falco·Teleport…) 자체 설치 자동화 — worker guide 로 안내만
- 멀티테넌시(단일 테넌트), 결제·과금, SecuFTPL 파인튜닝 파이프라인 통합(모델 소비만)

## 4. 사용자 경험 (How — User Flow)

**시나리오 1: 운영자 — 설치 및 첫 실행 (Cloud-API)**
```
git clone SeCuardian-Basic → cp .env.example .env.local → ANTHROPIC_API_KEY 입력
→ make local-all            (SQLite + Ollama Docker(cpu) + BE 8200 / FE 4200 pm2)
→ http://localhost:4200     → Setup Wizard(supervisor 생성 · LLM provider 선택)
→ /agents 에서 코어 Agent(Orchestrator, AI 어시스턴트) 활성 확인 — 보안 Agent 는 0개
```

**시나리오 2: 운영자 — SeCMP 에서 보안 Agent 설치**
```
/settings → MARKETPLACE_BASE_URL·API_KEY (또는 .env) → /agents → "마켓플레이스" 탭
→ 카탈로그(security/utilities, version, worker 유무) → velociraptor-dfir 선택 → 설치
→ 서버: download → sha256 대조 → scan_zip → manifest v2 → requires 검사 → deps 설치
        → SQL → 라우터 핫로드 → tbl_addon_agents(version, checksum, manifest_json) → UI 반영
→ 활성화 시 worker 요약 + WorkerGuideModal(velociraptor-dfir-worker-guide.md) → 외부 스택 연결
→ required_env(VELOCIRAPTOR_URL…) 미설정 → 경고 배너, API 는 503 graceful
```

**시나리오 3: 개발자 — 독립 보안 Addon 개발·게시**
```
cd addon-agents && make init AGENT=CveWatch
→ CveWatch-app.py: from app.addon_sdk import get_current_user, require_role, fetch_all, PH  (SDK 만)
→ CveWatch-meta.json(v2): agent_key, version, dependencies, requires, worker, required_env
→ make test AGENT=CveWatch  (SDK-only import · manifest 스키마 · 방언 중립 DDL · from __future__ 금지 · scan_zip)
→ make publish AGENT=CveWatch → CveWatch.zip → SeCMP 자산 등록
```

**시나리오 4: 내장 보안 Agent → Addon 이식 (keycloak-monitor 예)**
```
app/routers/router_keycloak.py + app/core/keycloak.py → addon-agents/catalog/security/keycloak-monitor/
→ keycloak-monitor-app.py (router prefix 제거 → /api/addon/keycloak-monitor/...), keycloak 클라이언트는 keycloak_monitor_lib/
→ meta v2: worker{external, guide}, required_env=[KEYCLOAK_URL, KEYCLOAK_ADMIN_*], agent_type=service
→ Basic 에 업로드 → 부팅·/health·API smoke → SeCMP security/ 카탈로그 추가
```

## 5. 성공 지표 (Success)

| KPI | 기준선 | 목표값 | 측정 방법 |
|---|---|---|---|
| 기존 Agent 27종(13 addon + 5 템플릿 + 9 내장→addon) 클린 Basic 설치 성공률 | 13/27 (내장 9종은 코어 코드, 템플릿 4종 `_PH` 결합, seed 후 13종 409) | **27/27** 부팅·API smoke | `test/impl/<N>th/` pytest |
| 결함 D1~D15 해소 | 0건 | 15건 (P0 범위 12건 이상) | §B-6 체크 |
| 코어 `app/` 에 남은 보안 스택 참조 | 26 라우터 + 4 core 모듈 + config 필드 30+ | **0** (`grep -ri "wazuh\|keycloak\|vault\|falco" app/` = 0) | CI grep |
| Addon 이 import 하는 코어 모듈 | `app.core.deps`, `app.db._PH` | **`app.addon_sdk` 단일**(shim 경유 허용, 게시 심사 시 SDK-only 권고) | `make test AGENT=` |
| manifest v2 검증 통과 | 0/21 (MAS-Basic 스키마 기준) | 27/27 (레거시 alias 포함) | `load_manifest_bytes` 단위 테스트 |
| 코어 수정 없는 Agent 추가 | 의존성은 pyproject 수정 필요 | **0건 (의존성 포함)** | 27종 이식 시 `app/` diff = 0 |
| pytest 자동화 | `test/impl/*` 수동 시나리오 위주 | 부팅/업로드/토글/삭제/SDK/manifest/deps/scan/27종 ≥ 50 케이스 | `make test` |
| 최초 실행까지 소요 | 가정: 4h | 2h 이내(보안 스택 설치 불필요) | 온보딩 실측 |

## 6. 리스크 및 메모

- **주요 리스크**
  - Addon 임의 코드가 API 프로세스 내 실행 + `docker.sock` 마운트 → 호스트 장악 등가. **P0 완화**: scan_zip CRITICAL 차단, docker.sock 기본 제거(`ADDON_WEB_REBUILD=none`), supervisor 전용 설치, 서명(P2). 완전 해결(샌드박스)은 Open Question.
  - `ai-redteam` 같은 공격형 Agent 가 마켓에서 1클릭 설치 → 격리 미보장. 완화: manifest `isolation_required=true` + `governance.approval=written` 이면 설치 시 확인 단계 + `REDTEAM_NETWORK` 필수 env 검사(방어자 정체성 원칙).
  - 의존성 설치(F6)가 코어 venv 오염. 완화: 허용목록 + 핀 + `--dry-run` + 실패 롤백.
  - 내장 9종 → Addon 이식 시 코어 `core/keycloak.py`·`vault_loader.apply_vault_secrets`(lifespan 훅) 제거로 **Vault 시크릿 주입 기능 소실**. 완화: `vault-monitor` Addon 이 `required_env` 로 선언, 시크릿 주입은 배포 계층(compose secrets/K8s Secret)으로 이동. 가정: Basic 고객은 Vault 필수 아님.
  - SeCMP host 가 서명·manifest 검증 없이 checksum 만 제공 → 신뢰 경계는 인스턴스. **의존성 명시**(SeCMP 요구사항 5건 §B-9).
- **의존성**: Anthropic API(선택), Ollama/llama.cpp/vLLM, Docker Engine, uv, pnpm, pm2, PostgreSQL 17, Redis 7.4, SeCMP host(F9), 외부 보안 스택(Agent 별 worker).
- **미결정 사항**
  - Addon 런타임 샌드박스 수준(subprocess/gVisor/별도 컨테이너) — P2 이후
  - Agent 버전 업데이트 정책(in-place vs side-by-side, 롤백) — F9 설계 시 확정
  - `agent_key` 정책: SeCuardian/SeCMP 하이픈 소문자 vs MAS-Basic 언더스코어 — **본 PRD: 하이픈 허용**(기존 13종 무수정), SeCMP 와 합의 필요
  - 내장 9종 중 `compliance-isms` 와 addon `isms-p-evidence` 중복 → 통합 여부
  - 가정: Ollama 없는 순수 Cloud LLM 실행 경로 유지(`OLLAMA_ENABLED=false`)

---

# Part B. 풀스펙 확장 (`--full`)

## B-1. 시스템 아키텍처

### B-1.1 논리 구조 (SeCuardian 코어 100% 준용 + 확장점)

```
┌──────────────────────────── SeCuardian-Basic Instance ─────────────────────────────┐
│ front (Vite 7 + React 19, :4200)                                                    │
│   /chat /agents(카탈로그·ZIP·마켓플레이스 3탭) /users /settings /profile /setup       │
│   /addon/{key}  pages/addon/deployed/{key}.tsx ← Addon 프론트 (import.meta.glob)     │
│   api/client.ts ★ Addon 프론트가 import 가능한 유일 코어 모듈                        │
├────────────────────────────────────────────────────────────────────────────────────┤
│ api (FastAPI, :8200)                                                                 │
│   routers(14): auth users agent chat_history suggestions addon_agent llm settings   │
│                setup agent_config agent_registry a2a mcp mcp_config                 │
│   agents:  OrchestratorAgent(classify→gather→synthesize, call_api 화이트리스트)        │
│   addon_agent_loader: importlib 핫로드/언로드 ★ → /api/addon/{key}/...               │
│   addon_sdk ★  공개 SDK (deps·db·settings·llm·i18n·paths)                           │
│   services: llm_providers/llm_router/llm_metering/token_compress/llm_fallback        │
│             mcp_proxy_server(per-agent :20000+) openapi_to_mcp ollama_warmup         │
│             addon_manifest ★ addon_validator ★ addon_deps ★                           │
│   core: config(BASE_DIR ★) deps security i18n   (vault/keycloak/logto 제거 ★)         │
│   db.py: raw SQL, SQLite/PG 듀얼(_PH), sql/{sqlite,pg}/*.sql 멱등 마이그레이션         │
├────────────────────────────────────────────────────────────────────────────────────┤
│ addon-agents/deployed/{key}/ {Name}-{app.py,front.tsx,sql.sql,meta.json,worker-guide.md}│
│                              [{key}_lib/ 서브패키지 · data/ 허용 ★]                    │
│ addon-agents/catalog/{security,utilities,addon}/ ★ 이식 패키지 소스 (SeCMP 자산 동기)  │
├────────────────────────────────────────────────────────────────────────────────────┤
│ postgres17 | redis7.4 | ollama(cpu|gpu) | llamacpp | vllm  (| MLX host-native)       │
└────────────────────────────────────────────────────────────────────────────────────┘
        ▲ catalog/download (HTTPS, sha256[, sig P2])        ▲ worker API (Wazuh/Falco/…)
┌───────┴────────────────┐                        ┌──────────┴────────────────┐
│ SeCuardian-Marketplace │                        │ 외부 보안 스택 / 타 인스턴스 │
│ /api/marketplace-host  │                        │ (A2A agent-card · MCP)      │
└────────────────────────┘                        └───────────────────────────┘
★ = Basic 신규/변경 지점. 나머지는 SeCuardian 그대로.
```

### B-1.2 Addon SDK 계약 (F4)

```python
# app/addon_sdk.py — Addon 이 import 해도 되는 유일한 모듈 (SemVer, 하위호환 보장)
__sdk_version__ = "1.0.0"
from app.core.config import BASE_DIR, settings
from app.core.deps import get_current_user, require_role
from app.core.i18n import norm_descriptions, parse_lang_map
from app.db import _PH as PH, _IS_SQLITE as IS_SQLITE
from app.db import fetch_all, fetch_one, execute_write, execute_insert
from app.services.llm_fallback import call_local_llm
async def call_llm(prompt, system="", model=None) -> str
def addon_data_dir(agent_key) -> Path      # 모델·업로드 저장 (CWD 비의존, ADDON_DATA_PATH)
def addon_file(agent_key, *parts) -> Path  # 배포 디렉터리 내 읽기전용 자원
```
- 호환: `from app.core.deps import ...`, `from app.db import _PH` 는 모듈 유지로 **계속 동작**. `make test` 는 경고, SeCMP 게시 심사 시 SDK-only 권고.
- 금지: Addon → `app.services.<도메인>`, Addon → 다른 Addon 파이썬 import. 데이터 공유는 **테이블(`tables_owned`) 또는 HTTP(`/api/addon/{other}/...`)**.
- 프론트: `../../../api/client` 만 허용(`store/auth` 는 P1 검토).

### B-1.3 Addon 패키지 규격 v2 (F5)

```
{Name}.zip
├── {Name}-app.py            # router = APIRouter() export (선택) — from __future__ import annotations 금지
├── {Name}-front.tsx         # default export React (선택)
├── {Name}-sql.sql           # 방언 중립 DDL (SERIAL/NOW() → 로더가 SQLite 변환, AUTOINCREMENT → PG 변환)
├── {Name}-meta.json         # 매니페스트 v2 (필수로 격상)
├── {Name}-worker-guide.md   # worker.required=true 이면 필수
├── {key}_lib/               # 선택: 내부 파이썬 서브패키지
└── data/                    # 선택: 샘플 → addon_data_dir(key)
```

```json
{
  "schema_version": 2,
  "agent_key": "velociraptor-dfir",
  "display_name": {"ko": "Velociraptor DFIR", "en": "Velociraptor DFIR"},
  "description":  {"ko": "...", "en": "..."},
  "version": "1.1.0",
  "agent_type": "service",
  "categories": ["security", "dfir"],
  "has_front": false,
  "dependencies": {"python": ["httpx>=0.27,<1"]},
  "requires": {"core": ">=1.0.0", "sdk": ">=1.0.0", "agents": []},
  "tables_owned": [],
  "permissions": ["llm", "network.egress"],
  "required_env": ["VELOCIRAPTOR_URL", "VELOCIRAPTOR_API_KEY"],
  "optional_env": ["VELOCIRAPTOR_ENABLED"],
  "worker": {"required": true, "kind": "external", "name": "Velociraptor",
             "version": ">=0.7", "guide": "velociraptor-dfir-worker-guide.md"},
  "capabilities": [{"verb": "collect", "domain": "dfir", "description": "..."}],
  "governance": {"isolation_required": false, "approval": "none"},
  "publisher": "edentns", "license": "Proprietary"
}
```
- `agent_key`: meta 우선, 없으면 zip stem 소문자. 정규식 `^[a-z][a-z0-9_-]{1,40}$`. 레거시 `key`/`type`/`min_platform_version`/`db_tables` alias 승격.
- `requires.agents` 미충족 → 409 + 설치 순서 안내. `tables_owned` 는 삭제 시 DROP 대상(DDL 정규식 추출 폴백).
- `governance.isolation_required=true` → 설치 확인 단계 + `required_env` 전량 필수(ai-redteam).

### B-1.4 데이터 흐름 — Addon 설치(업로드/마켓 공통)

```
ZIP → sha256 → scan_zip(kind=worker 면 바이너리 정책) → meta v2 로드(alias 승격) → agent_key 검증
→ 중복 판정(R22-7: builtin_update | duplicate | builtin_conflict, force) → requires.core/sdk/agents
→ dependencies.python: --dry-run → install (실패: 전체 롤백)
→ 백업 → _safe_extract → deployed/{key}/ → data/ → addon_data_dir
→ SQL 방언 정규화 → split_sql(주석·문자열 안전) → strict 실행 (실패: 롤백 + 400 + 사유)
→ _remove_routes(prefix) → load_router → tbl_addon_agents(version, checksum, manifest_json,
   installed_from, scan_result, sql_path=key기준) → tbl_agent_config(descriptions/agent_names JSON)
→ capabilities 재삽입 → front.tsx → ADDON_FRONT_DEPLOYED_PATH → ADDON_WEB_REBUILD 전략
→ MCP 프록시 포트 할당 → 응답에 worker 요약 + required_env 누락 경고
```

## B-2. 소프트웨어 스택

| 레이어 | 기술 (SeCuardian 동일) | Basic 변경 |
|---|---|---|
| Backend | FastAPI ≥0.115 · Python 3.12 · uv · raw SQL(`app/db.py`) · pydantic v2 · SQLAlchemy/Alembic 선언(미사용) | `addon_sdk`, `addon_manifest`, `addon_validator`, `addon_deps` 추가; `hvac`·`core/vault*`·`keycloak`·`logto` 제거 |
| Frontend | Vite 7 · React 19 · TS · Tailwind v4 · react-router 7 · TanStack Query 5 · axios · i18n(ko/en/jp) | 보안 전용 페이지 제거, 마켓플레이스 탭 `updates` 표시, WorkerGuideModal 유지 |
| DB | SQLite(local) / PostgreSQL 17(dev+) · Redis 7.4 | `tbl_addon_agents` + `version, checksum, manifest_json, installed_from, scan_result`; `tbl_addon_dependencies` |
| LLM | Anthropic(primary) · Ollama/llama.cpp/vLLM provider 추상화(R19) · Route/Metering/Token 압축 | 동일. `docker-compose.mlx.yml` 추가(MAS-Basic 이식) |
| Auth | python-jose JWT · bcrypt · pyotp TOTP · RBAC(supervisor/admin/user/viewer) | 동일. Keycloak/Logto SSO 는 Addon(P2 검토) |
| 프로토콜 | MCP(JSON-RPC 2.0, per-agent proxy) · A2A(agent-card, tasks SSE) · Registry v2 | 동일 |
| 패키징 | flat ZIP + meta.json + worker-guide | v2 매니페스트, `{key}_lib/`, sha256, scan_result |
| 실행 | pm2(local) · Docker Compose(dev/staging/prod) · `standalone/` · `deploy/{ansible,ci,docker,k8s,systemd}` | Helm 실물(P2), compose 보안 서비스 env 제거 |
| 품질 | ruff · pytest · SonarQube(선택) · GitHub Actions | pytest 스위트 확대, `grep` 코어 순수성 CI |

모델 기본값: SeCuardian 준용(Orchestrator sonnet 계열 / Domain haiku 계열, Settings 에서 런타임 변경). 가정: Claude 5 계열 전환은 코드 기본값 변경 없이 Settings.

## B-3. 하드웨어·배치 구성 (On-prem / Cloud / Hybrid)

### B-3.1 배치 토폴로지

| 토폴로지 | 구성 | LLM | 적합 고객 | 근거 |
|---|---|---|---|---|
| **T1. Cloud-API (기본)** | 단일 VM Docker Compose + Anthropic API | Claude(주) + Ollama CPU 폴백 | 데이터 반출 허용 SME | SeCuardian local/dev 현행 |
| **T2. On-prem GPU** | 단일 서버 NVIDIA GPU, `docker-compose.gpu.yml`, `OLLAMA_RUNTIME=gpu` 또는 `vllm` profile | vLLM/Ollama 로컬(주) + 선택적 Claude | 공공·금융·폐쇄망(데이터 무반출) | R19, Survey §6 |
| **T3. Apple Silicon Edge/PoC** | Mac mini/Studio, `OLLAMA_RUNTIME=mlx` 호스트 네이티브 | MLX 4bit | PoC·현장 데모 | R19-mlx |
| **T4. Private/Public Cloud** | AWS(ap-northeast-2) EC2/RDS/ElastiCache, Naver/KT Cloud(CSAP) | Claude via Bedrock/직접 + 옵션 GPU | 공공·대기업 | SeCMP DEPLOY 가이드 |
| **T5. Hybrid** | On-prem Basic(데이터·Agent·SIEM 연동) + Cloud/사내 SeCMP(카탈로그) + Cloud LLM 선택 | 정책 라우팅(LLM Route: 민감 task → 로컬) | 규제 산업 다수 | **본 PRD 목표 구조** |
| **T6. Air-gap** | 폐쇄망, SeCMP airgap 반입(ZIP+sha256), `OLLAMA_ENABLED`+로컬 wheel(`ADDON_DEPS_FIND_LINKS`) | 로컬 전용 | N2SF C 등급 | SeCMP §7.3 airgap |
| **T7. Kubernetes** | Helm(P2), api HPA, MCP 프록시는 `/mcp/{key}` 단일 경로 | 위 조합 | 다중 인스턴스 | deploy/k8s |

### B-3.2 사이징 가이드

**API/FE/DB (LLM 제외)**
| 환경 | AWS | 온프렘 등가 | 메모 |
|---|---|---|---|
| local(Ollama 미사용) | t3.medium (2vCPU/4GB) | 2C/4GB | SQLite |
| local(Ollama CPU 3~8B) | t3.large (2vCPU/8GB) | 4C/16GB | `OLLAMA_KEEP_ALIVE=-1` |
| staging | t3.xlarge~m6i.large | 4C/16GB + PG | |
| prod | m6i.xlarge (4vCPU/16GB) + RDS db.t4g.medium + ElastiCache | 8C/32GB | 고트래픽 m6i.2xlarge |

**로컬 LLM GPU (T2)** — Survey §6.1 근거(정밀 수치는 벤더 문서 재확인)
| 모델 규모 | 최소 GPU(4bit) | 권장(FP16/동시성) | 용도 |
|---|---|---|---|
| 3~8B (Llama 3.x, EXAONE 3.5 7.8B, Kanana, **Foundation-Sec-8B**) | RTX 4090 24GB / L4 24GB | L40S 48GB | Domain Agent·SOC triage 보조 |
| 14~32B (Qwen3 14B/32B, EXAONE 32B) | L40S 48GB / A6000 48GB | A100 80GB ×1 | Orchestrator 대체 |
| 70B+ (Llama 3.x 70B, HyperCLOVA X) | A100 80GB ×2 (4bit) | H100 80GB ×2~4 | 고품질 온프렘 전용 |
- 서빙: 단일/PoC → Ollama, 다중 동시 → **vLLM**(OpenAI 호환, R19 `vllm` provider); Mac → MLX. 보안 특화 모델(Foundation-Sec-8B, SecuFTPL 산출 GGUF/MLX)은 분석 보조 레이어에 배치.
- 동시성 참고(Survey/Perplexity): 8B 급 RTX 4090 vLLM 250+ tok/s, Ollama single-slot 큐잉 → 5인 이상 동시 사용 시 vLLM.

### B-3.3 네트워크·보안 배치
- 인바운드: FE 4200(또는 443 리버스프록시), SSH 22(IP 제한). API 8200·PG 5432·Redis 6379·Ollama 11434·vLLM 8100 은 내부망.
- per-agent MCP 20000+ 는 `network_mode: host` 전제 → K8s 는 `/mcp/{key}` 경로 사용, 프록시 포트 비활성.
- `api` 컨테이너 `docker.sock` **기본 제거**(`ADDON_WEB_REBUILD=none`). 필요 시 빌더 사이드카.
- 외부 보안 스택(Wazuh/Falco/Teleport…) 연결은 Agent 별 `required_env` URL + 토큰, egress 만. `ai-redteam` 은 `REDTEAM_NETWORK=redteam-isolated` 별도 네트워크.
- 동일 호스트 다중 인스턴스: `COMPOSE_PROJECT_NAME` + 포트 오프셋(8300/4300/5433/6380/11435).

## B-4. 비기능 요구사항 (NFR) — `ict-saas` + govtech 델타

| 영역 | 요구사항 | 출처 |
|---|---|---|
| 보안 | scan_zip CRITICAL 차단, sha256 기록, supervisor 전용 설치, `.env.*` 미커밋, JWT 시크릿 32자+, TOTP 유지, 공격형 Agent 설치 확인 단계, OWASP LLM/Agentic Top10 스코어카드(P1) | ict-saas, COMPLIANCE, SeCMP 부록 C |
| 감사 | `tbl_audit_log` 에 addon.install/update/toggle/delete, user CRUD, settings 변경 실기록(P1) | ISMS-P 접근로그·변경관리 |
| 가용성 | 단일 노드 99%(가정). Addon 로드 실패가 코어 부팅을 막지 않음(격리 로그 + UI 경고). worker 부재 시 503 graceful | R22 |
| 성능 | 채팅 첫 토큰 ≤ 3s(Claude), Addon 업로드→활성 ≤ 30s(deps 제외), web 재빌드 ≤ 60s(compose) | SeCuardian 준용 |
| 이식성 | SQLite↔PG 동일 결과(DDL 양방향), CWD 비의존, 폐쇄망 기동(F11) | D1/D2, F28 |
| 관측성 | 구조화 로그, `/health` 에 addon·provider 상태, `tbl_llm_usage` 미터링, OTel 훅(P2) | R19-3 |
| 다국어 | ko/en/jp — `descriptions` JSON dict 키 추가로 확장, split 컬럼 금지 | R18-7/R20-5 |
| 접근성 | KWCAG 2.2(govtech 납품 시) | SeCMP govtech |
| 규제 | 정보통신망법·PIPA, ISMS-P, CSAP/N2SF(공공), SOC2/ISO27001, AI 기본법(고영향 AI 판단은 Agent 별) | ict-saas, Survey §6.4 |

## B-5. 기존 Agent 이식 매트릭스 (F7)

| 출처 | Agent | 유형 | 난도 | 필요 조치 |
|---|---|---|---|---|
| addon/zip | agentic-soc, ai-eval-gate, ai-redteam, behavior-noti, cilium-netpol, isms-p-evidence, neosync-dlp, otel-collector, shuffle-soar, teleport-pam, teler-ids, vasca-cve, velociraptor-dfir (13) | service/execution/federation/tool-proxy | **낮음** | import 실측 21/21 OK. meta v2 승격(alias 자동), `seed-security` 폐지로 is_builtin=0 등록, isms-p-evidence worker-guide 추가, ai-redteam `governance.isolation_required` |
| addon/zip | VASCA_worker, BehaviorNotiService_worker (2) | worker | 낮음 | `kind=worker` 다운로드 전용, scan_zip 바이너리 정책 예외 |
| _templates | Board, UserManager, RagAgent, ServiceAgent (4) | app/rag/service | 중 | `from app.db import _PH` → `from app.addon_sdk import PH`(shim 으로 무수정도 동작), meta v2 |
| _templates | ToolProxyAgent (1) | tool-proxy | 낮음 | meta v2 |
| 내장(router) | keycloak-monitor(router_keycloak+core/keycloak.py), vault-monitor(router_vault+core/vault*.py), falco-receiver, harbor-scanner, crowdsec-monitor, hardening-auditor, wazuh-siem, compliance-isms (8) | service | **높음** | 라우터 → `{key}-app.py`(prefix `/api/addon/{key}`), 코어 모듈 → `{key}_lib/`, config 필드 → `required_env`(os.getenv), Makefile 타깃 → worker-guide.md, seed 항목 → meta. `vault_loader` lifespan 훅은 배포 계층으로 이동 |
| 내장(router) | vasca-cve (내장 판) | service | 낮음 | addon 판이 이미 존재 → 내장 판 폐기 |
| 내장(router, 시드 미포함) | caddy, cilium, istio, teler, wireproxy, soar, dfir, teleport, neosync, otel, redteam, ai_eval, behavior, agentic_soc, observability, isms (16 라우터) | — | — | addon 13종과 중복 → **코어에서 제거**, observability 는 `grafana-dashboard`(SeCMP utilities) 로 대체 |

## B-6. SeCuardian 결함 대응표 (F3)

| ID | 결함 (file:line) | 대응 | 우선 |
|---|---|---|---|
| D1 | CWD 상대경로 `addon_agent_loader.py:16`, `router_addon_agent.py:30-36,260`, `db.py:157` | `BASE_DIR` + `settings.addon_{deployed,templates,front_deployed,data}_path` | P0 |
| D2 | `sql_path` 상대 문자열 저장 `router_addon_agent.py:1242` | key 기준 `_resolve()` 재해석 + `tables_owned` | P0 |
| D3 | 라우터 언로드 불가 `loader:140-143`, 삭제 시 미호출 `1597-1654` | `_remove_routes(prefix)` + `_bump_router_version`, 삭제·비활성·재업로드 모두 호출 | P0 |
| D4 | `except Exception: pass` 8곳 | `apply_sql(strict=True)`, 실패 표면화(400 + 사유), 로그 | P0 |
| D5 | `_COMPOSE_FILE=/app/docker-compose.yml`, docker.sock 마운트 | `ADDON_WEB_REBUILD=none|compose|webhook`, sock 기본 제거 | P0 |
| D6 | `_kill_port` 임의 PID SIGTERM `68-94` | 자기 자식 프로세스(MCP 프록시) PID 추적만 종료 | P1 |
| D7 | 포트 8100/4100 vs 8200/4200 혼재 `Makefile:41,45`, `marketplace_port=8100` vs `VLLM_PORT` | 8200/4200 단일화, 모두 `BACKEND_PORT/FRONTEND_PORT` 참조, marketplace_port 기본 8100→SeCMP 실제(문서화) | P0 |
| D8 | 브랜딩·보안 스택 하드코딩(config/compose/Makefile/locales/AppLayout/LoginPage) | `SeCuardian-Basic` 스윕, 보안 env/타깃 제거 | P0 |
| D9 | 보안 라우터 26개 무조건 include `main.py:143-171`, `seed_security.py` | 제거(F2) | P0 |
| D10 | meta `dependencies/min_platform_version/required_env` 미검증 `_parse_meta_json:151-163` | manifest v2 + deps.ensure + satisfies + env 경고 | P0 |
| D11 | 템플릿 `from app.db import _PH` | `addon_sdk` + 템플릿·README 교체(shim 유지) | P0 |
| D12 | ZIP 검증 최소 `_check_safe_names:127-131` | scan_zip 이식 | P0 |
| D13 | `agent_key=zip_stem.lower()` 만, meta 무시 `1163` | meta `agent_key` 우선 + 정규식 | P0 |
| D14 | 잔여물 `.omc`, `.DS_Store`, `__pycache__`, `local.db` 커밋 | 정리 + `.gitignore` | P0 |
| D15 | `BaseAgent` 서브클래스 0 | 유지(Agent-type Addon F17 기반) | P2 |

## B-7. 데이터 모델 변경 (SeCuardian 스키마 유지 + 추가)

```sql
-- apply_column_migrations (SQLite PRAGMA / PG ADD COLUMN IF NOT EXISTS)
ALTER TABLE tbl_addon_agents ADD COLUMN version        TEXT DEFAULT '1.0.0';
ALTER TABLE tbl_addon_agents ADD COLUMN checksum       TEXT;   -- sha256
ALTER TABLE tbl_addon_agents ADD COLUMN manifest_json  TEXT;   -- v2 정규화 원문
ALTER TABLE tbl_addon_agents ADD COLUMN installed_from TEXT;   -- upload | marketplace:<url> | scaffold
ALTER TABLE tbl_addon_agents ADD COLUMN scan_result    TEXT;   -- scan_zip 요약
CREATE TABLE IF NOT EXISTS tbl_addon_dependencies (
  agent_key TEXT NOT NULL, package TEXT NOT NULL, spec TEXT, installed_at TIMESTAMP DEFAULT NOW());
```
`tbl_agent_config.descriptions/agent_names` JSON(다국어) · `tbl_addon_agent_capabilities` · `tbl_agent_registry` 는 그대로.

## B-8. Epic / 마일스톤

| Epic | 내용 | 산출물 | 검증 |
|---|---|---|---|
| E1. 코어 복제·보안 분리·결함 수정 (P0) | SeCuardian → Basic 복제, 보안 라우터/코어 모듈/seed/Makefile/compose 제거, 브랜딩, D1~D5/D7~D9/D13/D14 | `SeCuardian-Basic/` 부팅, `make lint`, 코어 순수성 grep=0 | `test/impl/1st/` |
| E2. Addon SDK + 매니페스트 v2 + deps + scan (P0) | `addon_sdk.py`, `addon_manifest.py`(SeCuardian 방언), `addon_validator.py`, `addon_deps.py`, `manifest.schema.json`, 로더 교체, 컬럼 마이그레이션, addon-agents Makefile v2 | 템플릿 5종 v2 화 | `test/impl/2nd/` |
| E3. 보안 Addon 13종 + worker 2종 + 템플릿 5종 이식 (P0) | `addon-agents/catalog/{security,addon}/` | 20/20 업로드·smoke | `test/impl/3rd/` |
| E4. 내장 8종 → Addon 이식 (P0) | SeCMP `marketplace-assets/security/{keycloak-monitor,vault-monitor,falco-receiver,harbor-scanner,crowdsec-monitor,hardening-auditor,wazuh-siem,compliance-isms}` + worker-guide (Basic 저장소 미동봉) | 8/8 import·smoke, SeCMP 자산 등재 | `test/impl/4th/` |
| E5. SeCMP 클라이언트 강화·하드웨어 프로파일·프론트 분리 (P1) | `updates`, requires 안내, `ADDON_FRONT_DEPLOYED_PATH`, compose mlx, 폐쇄망 | Mock host 로 install e2e | `test/impl/5th/` |
| E6. 문서·README·가이드 (P1) | README ko/en, addon-agents/README, AGENTS, COMPLIANCE, guides, 이행 가이드 | | 리뷰 |
| E7. 운영 하드닝·Helm·서명·Agent-type (P2) | Redis 상태, audit, OTel, Helm, Ed25519/GPG, `{Name}-agent.py` | | `test/impl/7th/` |

## B-9. SeCMP 측 요구사항 전달 (본 PRD 범위 외)

1. host 카탈로그 응답에 `manifest`(v2 정규화)·`signature`(GPG detached, 기존 `services/signature.py`) 필드 노출.
2. 자산 등록 시 manifest v2 스키마 검증 + `scan_zip` 실행 → `scan_result` 카탈로그 노출.
3. `agent_key` 정책 합의: 소문자 + 하이픈/언더스코어 허용.
4. `security/` 카테고리에 내장→Addon 9종(E4) 추가, `compliance-isms` vs `isms-p-evidence` 통합 결정.
5. 버전 협상: `catalog/{key}` 에 `versions[]` + `latest`, 인스턴스 `updates` 조회 지원.

## B-10. 규제·컴플라이언스 (COMPLIANCE.md 로 분리)

- `ict-saas` 베이스라인: 정보통신망법·PIPA, ISMS-P, CSAP(공공 클라우드). govtech 델타: N2SF 망분리(T6 air-gap), eGovFrame 연동 검토, KWCAG 2.2.
- 국제: SOC 2 Type II, ISO/IEC 27001, GDPR(EU 테넌트 시), EU CRA(제품 보안 요구, Survey §6.4).
- 데이터 등급: 인증/RBAC 토큰 = 규제대상, Addon 패키지 = 내부(무결성 검증), 감사로그 = 내부(보관 정책), SIEM/DFIR 수집 데이터 = Agent 별 선언(`compliance[]` P2).
- AI 기본법(2026-01 시행): 보안 판단 자동화(SOAR 자동 차단, 레드팀)는 고영향 후보 → HITL 게이트·설명가능성 요구. OWASP LLM Top 10 + Agentic Top 10 스코어카드(P1). KISA AI 레드티밍 가이드 준수(ai-redteam).

---

## 자가 점검 (prd-advisor §7)

- [x] Why/Who/What/How/Success 기재 · [x] In/Out 명시 · [x] KPI 기준선·목표·측정법 · [x] 리스크·의존성·미결정 · [x] 업종 오버레이 출처 인용 · [x] `가정:` 표기 6건 · [x] 기존 PRD 미덮어쓰기(신규 파일) · [ ] 사용자 검토 대기(비대화형 세션 — 설문은 요청문에서 도출)

## 변경 이력

- 2026-08-27 v0.2: 사용자 요구 반영 — F18(독립 시험 벤치: 전 Agent ZIP 동봉+설치 매트릭스), F19(스캐폴드/Export 무의존 보장, agent_key 정합, ShellAgent 템플릿 복원). F7 의 "저장소 미동봉" 은 deployed(런타임)에 한정하고 zip/ 은 시험 픽스처로 재정의.
- 2026-08-27 v0.1: 초안. SeCuardian/SeCMP/MAS-Basic 감사 보고서 기반. 스택은 SeCuardian 으로 확정되어 `/wise-dev-standard:recommend` 생략, E1 착수.
