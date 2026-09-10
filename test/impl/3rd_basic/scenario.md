# 3rd_basic 시험 시나리오 — 상위 프로젝트 변경 반영(SeCMP 자산 동기 E9/E10)

> 작성일 2026-09-10 · 근거: SeCuardian-Basic-PRD v0.3 (F18 독립 시험 벤치 · B-5 이식 매트릭스 · B-9 §6)
> 입력 델타: SeCuardian `9ce864d..4129b9f`(1 커밋) · SeCMP `a7fccc0..14183a8` + 미커밋(E9~E12) · SecuFTPL `1848d7f..c5c57b9`(v0.4)

| # | 시나리오 | 기대 결과 | 자동화 |
|---|---|---|---|
| 1 | SeCMP `marketplace-assets/*/*.zip` 전량이 `addon-agents/zip/` 에 동일 이름·sha256 으로 존재 | 50종 1:1 일치 (39 기존 + E9 7 + E10 4) | test_07 §fixture_zip_inventory · §fixture_zips_match_secmp_assets |
| 2 | 전 zip 50종 `scripts/addon_matrix.py` 업로드 | 48 OK / worker 2 REJECTED / 0 FAIL, missing_env 는 경고만 | scripts/addon_matrix.py (logs/) |
| 3 | 신규 11종을 픽스처 zip 으로 클린 Basic 에 설치 | 200 + `/api/addon-agents/` 목록 노출 | test_07 §new_security_addons_install_from_fixtures |
| 4 | E10 4종 `worker.required=true` → `/api/addon-agents/{key}/worker-guide` | 200 + guide 본문(worker-guide.md) | test_07 §e10_worker_guides_served |
| 5 | 신규 11종 `/api/addon/{key}/status` (외부 도구/worker 미기동) | 200 또는 503 우아한 저하, 5xx 예외 없음 | test_07 §new_addons_status_graceful |
| 6 | manifest: `worker.guide/version=null` | 400 대신 `""` 수용 | test_03 §worker_null_strings_coerced |
| 7 | SeCuardian `4129b9f`(B1/B2) 기반영 확인 | `_finalize_generated_meta`·`X-Scaffold-Warning` 존재, 2nd_basic 회귀 PASS | grep + pytest test/impl/2nd_basic |
| 8 | 1st/2nd_basic 회귀 | 전체 pytest PASS | make test |
