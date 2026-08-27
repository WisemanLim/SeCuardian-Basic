# SeCuardian-Basic — python-fastapi (wise-dev-standard / python-fastapi)
# 참조 구현: SmartHaccp-MultiAgent
.PHONY: dev dev-be dev-fe test lint build deploy up down standalone docker-standalone docker-standalone-save \
        local-all local-stop local-logs local-status \
        dev-all dev-stop dev-logs \
        staging-all staging-stop staging-logs \
        prod-all prod-stop prod-logs \
        db-reset seed db-fresh worker-package
ENV ?= local

# web(front) 이미지에서 배포된 ADDON 화면(front) 제외 여부 (front/Dockerfile 빌드 인자).
# api 이미지의 addon-agents/deployed 제외는 .dockerignore 가 담당(항상 제외).
# 이미지 빌드 컨테이너 환경(dev/staging/prod)은 기본 true → 배포 화면을 번들에 굽지 않음.
# ADDON 업로드 후 _rebuild_web 재빌드 시에는 이 값이 비어 false 로 처리되어 화면이 포함된다.
# 필요 시 override: SKIP_DEPLOYED_ADDONS=false make build ENV=prod
SKIP_DEPLOYED_ADDONS ?= $(if $(filter dev staging prod,$(ENV)),true,false)

# 포트를 .env.* 에서 읽는 헬퍼 (Makefile 변수, 레시피 외부에서 평가됨)
_port = $(shell grep '^$(1)=' .env.$(ENV) 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'" | xargs)

# ── 인프라 단독 (하위 호환) ───────────────────────────────────────────────────
up:      ## 인프라만 기동 (postgres + redis + ollama)
	@bash scripts/ollama_preflight.sh .env.$(ENV)
	@if docker compose --env-file .env.$(ENV) ps --status running -q ollama 2>/dev/null | grep -q .; then \
		docker compose --env-file .env.$(ENV) up -d; \
	else \
		docker compose --env-file .env.$(ENV) up -d postgres redis; \
	fi

down:    ## 전체 컨테이너 정리
	docker compose --env-file .env.$(ENV) --profile app --profile web down --remove-orphans

# ── 개발 서버 직접 실행 (터미널 분리용) ──────────────────────────────────────
dev-be:  ## 백엔드만 직접 실행 (uv + uvicorn --reload)
	@BACKEND_PORT=$$(grep '^BACKEND_PORT=' .env.$(ENV) 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'" || echo 8200); \
	uv run uvicorn app.main:app --reload --port $${BACKEND_PORT:-8200}

dev-fe:  ## 프론트엔드만 실행 (pnpm dev)
	@FRONTEND_PORT=$$(grep '^FRONTEND_PORT=' .env.$(ENV) 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'" || echo 4200); \
	cd front && pnpm dev --port $${FRONTEND_PORT:-4200}

dev:     ## 전체 개발환경 안내 (infra 기동 후 터미널 안내)
	@bash scripts/ollama_preflight.sh .env.$(ENV)
	@if docker compose --env-file .env.$(ENV) ps --status running -q ollama 2>/dev/null | grep -q .; then \
		docker compose --env-file .env.$(ENV) up -d; \
	else \
		docker compose --env-file .env.$(ENV) up -d postgres redis; \
	fi
	@BACKEND_PORT=$$(grep '^BACKEND_PORT=' .env.$(ENV) 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'" || echo 8200); \
	FRONTEND_PORT=$$(grep '^FRONTEND_PORT=' .env.$(ENV) 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'" || echo 4200); \
	echo "▶ Backend  → http://localhost:$${BACKEND_PORT:-8200}  (make dev-be)"; \
	echo "▶ Frontend → http://localhost:$${FRONTEND_PORT:-4200}  (make dev-fe)"; \
	echo "또는: make local-all  (pm2 백그라운드 통합 실행)"

# ── local — SQLite + Ollama(Docker) + BE/FE (pm2 비Docker) ───────────────────
local-all: ## local 전체 기동: Ollama Docker + BE/FE pm2 (SQLite 자동)
	@command -v pm2 >/dev/null 2>&1 || (echo "❌ pm2 필요: npm i -g pm2" && exit 1)
	mkdir -p logs
	@bash scripts/ollama_preflight.sh .env.$(ENV)
	@pm2 delete ecosystem.config.js >/dev/null 2>&1 || true
	@BACKEND_PORT=$$(grep '^BACKEND_PORT=' .env.$(ENV) 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'" || echo 8200); \
	FRONTEND_PORT=$$(grep '^FRONTEND_PORT=' .env.$(ENV) 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'" || echo 4200); \
	ENV=local BACKEND_PORT=$$BACKEND_PORT FRONTEND_PORT=$$FRONTEND_PORT \
		pm2 start ecosystem.config.js --env local
	pm2 save
	@BACKEND_PORT=$$(grep '^BACKEND_PORT=' .env.$(ENV) 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'" || echo 8200); \
	FRONTEND_PORT=$$(grep '^FRONTEND_PORT=' .env.$(ENV) 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'" || echo 4200); \
	echo "▶ Backend  → http://localhost:$${BACKEND_PORT:-8200}"; \
	echo "▶ Frontend → http://localhost:$${FRONTEND_PORT:-4200}"; \
	echo "▶ 로그: make local-logs"

local-stop: ## local 전체 중단 (pm2 + ollama)
	pm2 stop ecosystem.config.js || true
	docker compose --env-file .env.$(ENV) stop ollama

local-logs: ## local 로그 모니터링 (pm2)
	pm2 logs

local-status: ## local 프로세스 상태 (pm2)
	pm2 status

# ── dev — PostgreSQL + Redis + Ollama + BE + FE (Docker Compose) ──────────────
dev-all: ## dev 전체 기동 (.env.dev, docker compose)
	@bash scripts/ollama_preflight.sh .env.dev
	@if docker compose --env-file .env.dev ps --status running -q ollama 2>/dev/null | grep -q .; then \
		docker compose --env-file .env.dev --profile app --profile web up -d; \
	else \
		docker compose --env-file .env.dev --profile app --profile web up -d --scale ollama=0; \
	fi

dev-stop: ## dev 전체 중단
	docker compose --env-file .env.dev --profile app --profile web down

dev-logs: ## dev 로그 모니터링 (docker compose)
	docker compose --env-file .env.dev --profile app --profile web logs -f

# ── staging ───────────────────────────────────────────────────────────────────
staging-all: ## staging 전체 기동 (.env.staging, docker compose)
	@bash scripts/ollama_preflight.sh .env.staging
	@if docker compose -f docker-compose.yml --env-file .env.staging ps --status running -q ollama 2>/dev/null | grep -q .; then \
		docker compose -f docker-compose.yml --env-file .env.staging --profile app --profile web up -d; \
	else \
		docker compose -f docker-compose.yml --env-file .env.staging --profile app --profile web up -d --scale ollama=0; \
	fi

staging-stop: ## staging 전체 중단
	docker compose -f docker-compose.yml --env-file .env.staging --profile app --profile web down

staging-logs: ## staging 로그 모니터링
	docker compose -f docker-compose.yml --env-file .env.staging --profile app --profile web logs -f

# ── prod ──────────────────────────────────────────────────────────────────────
prod-all: ## prod 전체 기동 (.env.prod, docker compose)
	@bash scripts/ollama_preflight.sh .env.prod
	@if docker compose -f docker-compose.yml --env-file .env.prod ps --status running -q ollama 2>/dev/null | grep -q .; then \
		docker compose -f docker-compose.yml --env-file .env.prod --profile app --profile web up -d; \
	else \
		docker compose -f docker-compose.yml --env-file .env.prod --profile app --profile web up -d --scale ollama=0; \
	fi

prod-stop: ## prod 전체 중단
	docker compose -f docker-compose.yml --env-file .env.prod --profile app --profile web down

prod-logs: ## prod 로그 모니터링
	docker compose -f docker-compose.yml --env-file .env.prod --profile app --profile web logs -f api

# ── DB 관리 ───────────────────────────────────────────────────────────────────
# ENV=local(기본): 호스트에서 직접 실행 (SQLite)
# ENV=dev|staging|prod: 컨테이너 내 실행 (PostgreSQL)
#
# DB 초기화는 아래 db-reset / db-fresh 를 **직접 실행할 때만** 수행된다.
# make *-all / up / dev 등 기동 명령은 DB 를 초기화하지 않는다
# (앱 기동 시 seed(02_seed.sql)는 파일 해시 마커로 최초 1회만 적용 — app/db.py run_migrations).
_DB_RUN = $(if $(filter dev staging prod,$(ENV)),docker exec secuardian-api-1 uv run,uv run)

# 파괴적 명령 확인 가드 — FORCE=1 로 스킵 (CI 등)
define _CONFIRM_DESTRUCTIVE
	@if [ "$(FORCE)" != "1" ]; then \
		printf "⚠️  ENV=$(ENV) DB 데이터가 삭제됩니다. 계속하려면 'yes' 입력: "; \
		read ans; [ "$$ans" = "yes" ] || { echo "취소됨"; exit 1; }; \
	fi
endef

db-reset: ## DB 데이터 삭제 + 스키마 재생성 — 명시적 초기화 (FORCE=1 로 확인 생략)
	$(_CONFIRM_DESTRUCTIVE)
	$(_DB_RUN) python scripts/db_reset.py

seed:    ## 기본 설정 + 테스트 계정 삽입 — 기반 시드만 (ENV=prod make seed)
	$(_DB_RUN) python scripts/seed.py

db-fresh: ## db-reset + seed(기반) 순차 실행 (FORCE=1 로 확인 생략)
	$(_CONFIRM_DESTRUCTIVE)
	$(_DB_RUN) python scripts/db_reset.py
	$(_DB_RUN) python scripts/seed.py

# ── CI / 품질 ─────────────────────────────────────────────────────────────────
test:    ## pytest 실행
	uv run pytest

lint:    ## ruff 검사
	uv run ruff check .

# ── 빌드 / 배포 ───────────────────────────────────────────────────────────────
build:   ## 앱 이미지 빌드 (profiles:app + web) — 기본 이미지는 배포 ADDON 제외 (dev/staging/prod)
	SKIP_DEPLOYED_ADDONS=$(SKIP_DEPLOYED_ADDONS) docker compose --env-file .env.$(ENV) --profile app --profile web build

deploy:  ## Helm 배포
	helm upgrade --install wise-multi-ai-agent-template ./deploy/helm

# ── Worker 패키지 ─────────────────────────────────────────────────────────────
worker-package: ## Worker 배포 패키지 zip 재생성 (빌드 산출물 포함) — R22-1
	@test -f addon-agents/zip/VASCA_worker/bin/vasca || { echo "❌ addon-agents/zip/VASCA_worker/bin/vasca 없음 — VASCA_worker 의 worker-guide 에 따라 먼저 빌드(go build) 하세요"; exit 1; }
	cd addon-agents/zip && rm -f VASCA_worker.zip BehaviorNotiService_worker.zip && \
	zip -r -q VASCA_worker.zip VASCA_worker -x "*.DS_Store" && \
	zip -r -q BehaviorNotiService_worker.zip BehaviorNotiService_worker -x "*.DS_Store" -x "BehaviorNotiService_worker/build/*"
	@ls -lh addon-agents/zip/VASCA_worker.zip addon-agents/zip/BehaviorNotiService_worker.zip

AGENT ?= example
PORT  ?= 8001

standalone: ## Standalone 직접 실행 — AGENT=<agent_key> PORT=<port>
	AGENT_KEY=$(AGENT) uv run uvicorn standalone.standalone_app:app --port $(PORT)

docker-standalone: ## Standalone 이미지 빌드 — AGENT=<agent_key> PORT=<port>
	docker build -f standalone/Dockerfile.standalone \
		--build-arg AGENT_KEY=$(shell echo $(AGENT) | tr '[:upper:]' '[:lower:]') \
		--build-arg AGENT_PORT=$(PORT) \
		-t secuardian-agent-$(shell echo $(AGENT) | tr '[:upper:]' '[:lower:]'):latest .

docker-standalone-save: ## Standalone 이미지 tar export — AGENT=<agent_key>
	docker save -o secuardian-agent-$(AGENT).tar secuardian-agent-$(AGENT):latest
	@echo "✅ secuardian-agent-$(AGENT).tar 생성 — 대상 서버: docker load -i secuardian-agent-$(AGENT).tar"
