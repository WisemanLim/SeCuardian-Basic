# 3rd_basic 시험 결과 — PASS (2026-09-10)

## 판정 요약

| 시나리오 | 판정 | 근거 |
|---|---|---|
| 1. 픽스처 인벤토리·sha256 1:1 | **PASS** | 50종 = SeCMP `marketplace-assets/*/*.zip` 전량, 불일치 0 (test_07 2 케이스) |
| 2. 전 zip 설치 매트릭스 | **PASS** | 1차: 44 OK / 2 REJECTED / **4 FAIL** (E10 4종 `worker.guide` null) → 수정 후 2차: **48 OK / 2 REJECTED / 0 FAIL** (`logs/addon_matrix_try{1,2}.log`) |
| 3. 신규 11종 설치 | **PASS** | 전부 200 + 목록 노출 |
| 4. E10 worker-guide 서빙 | **PASS** | 4종 `/worker-guide` 200 + 본문 |
| 5. 신규 11종 `/status` 우아한 저하 | **PASS** | 200/503 만, 예외 없음 |
| 6. manifest null 수용 | **PASS** | test_03 §worker_null_strings_coerced |
| 7. SeCuardian `4129b9f` 기반영 | **PASS** | `_finalize_generated_meta`·`X-Scaffold-Warning` 4 매치, 2nd_basic 12/12 |
| 8. 전체 회귀 | **PASS** | `make test` **45 passed** (1st 28 · 2nd 12 · 3rd 5), `logs/pytest_try1.log` |

시도 회차: 매트릭스 2회(1차 FAIL 4 → 수정 → 2차 PASS), pytest 1회.

## 발견·수정된 결함 (원본 수정보완 사항)

| ID | 결함 | 수정 |
|---|---|---|
| B3-1 | SeCMP E10 자산 4종(logto-monitor·istio-mtls·wireproxy-ztna·observability-monitor) meta 가 `worker.required=true` 인데 `worker.guide: null` + worker-guide.md 미동봉 → Basic 업로드 400 `meta.json 검증 실패: worker.guide — Input should be a valid string` | ① Basic `app/services/addon_manifest.py` `AddonWorker` — `kind/name/version/package/guide` null → `""` 수용(before validator) ② SeCMP 원본 `marketplace-assets/security/{4종}/` 에 `{key}-worker-guide.md` 추가, meta `worker.guide` 기재, zip 재패키징(3파일) → Basic `addon-agents/zip/` 재동기. SeCMP `test/impl/54/run.py` 16/16 PASS 유지 |

## 반영 판정 (상위 프로젝트 델타)

| 출처 | 변경 | Basic 반영 |
|---|---|---|
| SeCuardian `4129b9f` | scaffold/export meta key 정합(B2)·템플릿 폴백(B1) | 기반영(Basic 벤치가 발견해 원본에 역전파된 건) — 확인만 |
| SeCMP E9 (impl/53) | 신규 보안 Addon 7종 | 픽스처 편입 + 설치 검증 |
| SeCMP E10 (impl/54) | 패키징 4종 | 픽스처 편입 + B3-1 수정 |
| SeCMP E11 (impl/55) | `router_governance` + `tbl_hitl_approvals` | 미반영 — SeCMP 플랫폼 기능(PRD Out of Scope). F14(P2) 후보로 PRD 기록 |
| SeCMP E12 (impl/56) | `router_playground` cost/eval | 미반영 — builtin `playground.zip` 무변경(sha256 동일) |
| SeCMP `14183a8` | 카테고리 문서(AGENTS-GAP·webloc) | 문서만, 자산 무변경 |
| SecuFTPL v0.4 (E13~E18) | 벤치·KTO·디컨탬·lora_variant·DOC_PARSER·RAG 합성 | 미반영 — 파인튜닝 내부, 모델 소비 계약 무변경 |

## 참고

- 기존 lint 13건은 `addon-agents/_templates/*-app.py` 의 미사용 import/E702 — 본 차수 범위 외(미수정).
