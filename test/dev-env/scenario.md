# Dev-Env 시험 시나리오

> **목적**: 개발 환경 필수 요건 검증  
> **실행 시점**: 최초 1회 (E01 T01-1 구현 전)

## 환경

- OS: macOS (darwin 25.5.0)
- Docker: Docker Desktop
- Python: 3.12+ (uv 관리)
- Make: GNU make

## 시나리오

| # | 검증 항목 | 명령 | 기대 결과 |
|---|---------|------|---------|
| D-01 | Docker 데몬 동작 | `docker info` | 오류 없음 |
| D-02 | Docker Compose 버전 | `docker compose version` | v2.x 이상 |
| D-03 | Python 버전 | `python3 --version` | 3.11 이상 |
| D-04 | uv 설치 | `uv --version` | 버전 출력 |
| D-05 | make 동작 | `make --version` | 버전 출력 |
| D-06 | curl 설치 | `curl --version` | 버전 출력 |
| D-07 | 기존 포트 충돌 확인 (8880) | `lsof -i :8880` | 출력 없음(미사용) |
| D-08 | 기존 포트 충돌 확인 (9880) | `lsof -i :9880` | 출력 없음(미사용) |
| D-09 | docker-compose.keycloak.yml 문법 | `docker compose -f deploy/docker/docker-compose.keycloak.yml config` | 파싱 성공 |
| D-10 | .env.keycloak 파일 존재 | `test -f deploy/docker/.env.keycloak` | exit 0 |
