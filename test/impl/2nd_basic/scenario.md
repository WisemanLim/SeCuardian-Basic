# 2nd_basic 시험 시나리오 — 독립 시험 벤치(F18) + 스캐폴드/Export 무의존(F19)

> 작성일 2026-08-27 · 근거: SeCuardian-Basic-PRD v0.2 F18/F19

| # | 시나리오 | 기대 결과 | 자동화 |
|---|---|---|---|
| 1 | SeCMP 전 Agent ZIP 39종을 `addon-agents/zip/` 에 동봉하고 `scripts/addon_matrix.py` 로 전량 업로드 | 37 OK / worker 2 REJECTED / 0 FAIL, missing_env 는 경고만 | scripts/addon_matrix.py |
| 2 | 스캐폴드 10개 유형(shell 포함) ZIP 생성 | 200 + meta agent_key=소문자 이름, requires.agents=[], dependencies.python=[], -app.py 는 SDK/shim import 만 | test_06 §scaffold_all_types |
| 3 | 생성 ZIP 을 그대로 업로드 설치 | 200 (키 불일치 없음 — 결함 B2 회귀) | 〃 |
| 4 | MCP Proxy 스캐폴드 | 200 + 무의존 규칙 동일 | test_06 §mcp_proxy |
| 5 | 설치본 export(새 이름) → 재설치 | 새 키 정합·base_agent 출처 표기·requires.agents=[]·재설치 200 | test_06 §export_roundtrip |
| 6 | 1st_basic 회귀 | 27 케이스 전부 PASS | pytest test/impl |
