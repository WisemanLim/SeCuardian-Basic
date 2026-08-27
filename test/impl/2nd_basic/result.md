# 2nd_basic 시험 결과 — PASS (2026-08-27)

## 판정 요약

| 시나리오 | 판정 | 근거 |
|---|---|---|
| 1. 전 Agent ZIP 39종 설치 매트릭스 | **PASS** | 37 OK / 2 REJECTED(worker, 의도됨) / 0 FAIL |
| 2~3. 스캐폴드 10 유형 무의존 생성+설치 | **PASS** | pytest 10 케이스 (shell 포함 — 결함 B1 수정 검증) |
| 4. MCP Proxy 스캐폴드 무의존 | **PASS** | pytest 1 케이스 |
| 5. Export 라운드트립 | **PASS** | 키 정합(결함 B2 수정 검증)·출처 표기·재설치 200 |
| 6. 1st_basic 회귀 | **PASS** | 전체 pytest 39/39 |

## 발견·수정된 결함 (원본 수정보완 사항)

| ID | 결함 | 수정 |
|---|---|---|
| B1 | `_TYPE_TEMPLATE["shell"]="ShellAgent"` 인데 템플릿 부재 → shell 유형 스캐폴드 404 | SeCMP ShellAgent.zip 에서 템플릿 복원 + SDK import 로 승격 (`addon-agents/_templates/ShellAgent/`) |
| B2 | scaffold/export 가 meta `agent_key` 미갱신(PascalCase 치환만) → 설치 시 원본 키로 등록되는 키 불일치 | `_finalize_generated_meta()` 로 agent_key=새이름 소문자 강제 (`router_addon_agent.py`) |
| G1 | 생성 ZIP 무의존 검증 게이트 부재 | `_assert_independent_app()` — SDK/shim 외 코어 import 시 400 `not_independent`; requires.agents 항상 비움; scaffold 는 dependencies.python=[] |

## 설치 매트릭스 전체 출력

```
BehaviorNotiService_worker  REJECTED(worker)   
Board                       OK                 
RagAgent                    OK                 
ServiceAgent                OK                 
ShellAgent                  OK                 
ToolProxyAgent              OK                 missing_env=TOOL_PROXY_BASE_URL
UserManager                 OK                 
VASCA_worker                REJECTED(worker)   
agentic-soc                 OK                 
ai-eval-gate                OK                 
ai-redteam                  OK                 
ai-traffic-monitor          OK                 
behavior-noti               OK                 
caddy-proxy                 OK                 
cilium-netpol               OK                 
compliance-isms             OK                 
crowdsec-monitor            OK                 missing_env=CROWDSEC_LAPI_URL
falco-receiver              OK                 missing_env=FALCO_WEBHOOK_ENABLED
grafana-dashboard           OK                 
guardrails                  OK                 
harbor-scanner              OK                 missing_env=HARBOR_URL
hardening-auditor           OK                 missing_env=HARDENING_WEBHOOK_ENABLED
isms-p-evidence             OK                 
keycloak-monitor            OK                 missing_env=KEYCLOAK_URL,KEYCLOAK_ADMIN_PASSWORD
marketplace                 OK                 
neosync-dlp                 OK                 
otel-collector              OK                 
playground                  OK                 
rag                         OK                 
server-shell                OK                 
shuffle-soar                OK                 
teleport-pam                OK                 
teler-ids                   OK                 
truffle-scan                OK                 
vasca-cve                   OK                 
vault-monitor               OK                 missing_env=VAULT_ADDR
velociraptor-dfir           OK                 
wazuh-siem                  OK                 missing_env=WAZUH_API_URL,WAZUH_API_PASSWORD
workflow                    OK                 

== 39 zips: 37 ok / 2 rejected / 0 fail
```

missing_env 경고(keycloak/vault/wazuh/harbor/crowdsec/falco/hardening/tool-proxy)는 외부 worker 스택 미연결 환경에서 의도된 동작(503 graceful).
