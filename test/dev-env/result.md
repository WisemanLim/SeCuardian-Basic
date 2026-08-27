# Dev-Env 시험 결과

> **판정**: PASS  
> **실행일**: 2026-06-26  
> **환경**: macOS darwin 25.5.0 / Docker Desktop

## 결과

| # | 검증 항목 | 결과 | 비고 |
|---|---------|------|------|
| D-01 | Docker 데몬 동작 | ✅ PASS | 29.5.3 |
| D-02 | Docker Compose 버전 | ✅ PASS | 5.1.4 |
| D-03 | Python 버전 | ✅ PASS | 3.14.5 |
| D-04 | uv 설치 | ✅ PASS | 0.10.9 |
| D-05 | make 동작 | ✅ PASS | GNU make |
| D-06 | curl 설치 | ✅ PASS | 8.7.1 |
| D-07 | 포트 8880 미사용 | ✅ PASS | lsof 결과 없음 |
| D-08 | 포트 9880 미사용 | ✅ PASS | lsof 결과 없음 |
| D-09 | compose 파일 문법 | ✅ PASS | `docker compose config --quiet` 성공 |
| D-10 | .env.keycloak 존재 | ✅ PASS | example 복사 후 생성 |

## 총평

전체 10개 항목 PASS. 구현 시험 진행 가능.
