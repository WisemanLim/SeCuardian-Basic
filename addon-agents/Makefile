# =============================================================================
# addon-agents/Makefile — Addon Agent 개발 도우미
# =============================================================================
#
# 사용법 (addon-agents/ 디렉터리에서 실행):
#   make init    AGENT=Survey   새 Agent 스캐폴딩
#   make test    AGENT=Survey   문법·구조 검증
#   make publish AGENT=Survey   zip 패키징 (업로드 준비)
#   make clean   AGENT=Survey   생성 파일 삭제
#
# AGENT 기본값: MyAgent
# =============================================================================

AGENT       ?= MyAgent
AGENT_LC     = $(shell echo '$(AGENT)' | tr '[:upper:]' '[:lower:]')
TMPL_SRC    := _templates/Board
TMPL_DIR    := _templates/$(AGENT)
ZIP_OUT     := _templates/$(AGENT).zip
PY          := $(shell test -f ../.venv/bin/python && echo ../.venv/bin/python || echo python3)

.DEFAULT_GOAL := help
.PHONY: help init test publish clean

# ─── help ─────────────────────────────────────────────────────────────────────
help:
	@printf '\n'
	@printf '  \033[1mAddon Agent 개발 도우미\033[0m  (addon-agents/Makefile)\n\n'
	@printf '  \033[1mmake init    AGENT=<name>\033[0m   새 Agent 템플릿 초기화\n'
	@printf '  \033[1mmake test    AGENT=<name>\033[0m   파일·문법·구조 검증\n'
	@printf '  \033[1mmake publish AGENT=<name>\033[0m   zip 패키징 (업로드 준비)\n'
	@printf '  \033[1mmake clean   AGENT=<name>\033[0m   생성 파일 삭제\n\n'
	@printf '  예시:\n'
	@printf '    make init    AGENT=Survey\n'
	@printf '    make test    AGENT=Survey\n'
	@printf '    make publish AGENT=Survey\n\n'
	@printf '  베이스 템플릿: $(TMPL_SRC)/\n'
	@printf '  Python:       $(PY)\n\n'

# ─── init ─────────────────────────────────────────────────────────────────────
init:
	@printf '>>> [init] Agent '\''$(AGENT)'\'' 초기화 중...\n'
	@if [ -d "$(TMPL_DIR)" ]; then \
		printf '  ERROR: '\''$(TMPL_DIR)'\'' 이미 존재합니다.\n'; \
		printf '         삭제하려면: make clean AGENT=$(AGENT)\n'; \
		exit 1; \
	fi
	@if [ ! -d "$(TMPL_SRC)" ]; then \
		printf '  ERROR: 베이스 템플릿 '\''$(TMPL_SRC)'\'' 없음\n'; \
		exit 1; \
	fi
	@mkdir -p "$(TMPL_DIR)"
	@sed -e 's/Board/$(AGENT)/g' \
	     -e 's/board/$(AGENT_LC)/g' \
	     "$(TMPL_SRC)/Board-app.py" > "$(TMPL_DIR)/$(AGENT)-app.py"
	@sed -e 's/Board/$(AGENT)/g' \
	     -e 's/board/$(AGENT_LC)/g' \
	     "$(TMPL_SRC)/Board-front.tsx" > "$(TMPL_DIR)/$(AGENT)-front.tsx"
	@sed -e 's/Board/$(AGENT)/g' \
	     -e 's/board/$(AGENT_LC)/g' \
	     "$(TMPL_SRC)/Board-sql.sql" > "$(TMPL_DIR)/$(AGENT)-sql.sql"
	@printf '\n'
	@printf '  \033[32mv\033[0m 생성 완료:\n'
	@printf '      $(TMPL_DIR)/$(AGENT)-app.py\n'
	@printf '      $(TMPL_DIR)/$(AGENT)-front.tsx\n'
	@printf '      $(TMPL_DIR)/$(AGENT)-sql.sql\n'
	@printf '\n'
	@printf '  다음 단계:\n'
	@printf '    1. 위 파일 수정 → Agent 기능 구현\n'
	@printf '    2. make test    AGENT=$(AGENT)\n'
	@printf '    3. make publish AGENT=$(AGENT)\n\n'

# ─── test ─────────────────────────────────────────────────────────────────────
test:
	@printf '>>> [test] Agent '\''$(AGENT)'\'' 검증 중...\n\n'
	@PASS=0; FAIL=0; \
	\
	for f in "$(TMPL_DIR)/$(AGENT)-app.py" "$(TMPL_DIR)/$(AGENT)-meta.json"; do \
		if [ -f "$$f" ]; then \
			printf '  \033[32mv\033[0m 존재: %s\n' "$$f"; PASS=$$((PASS+1)); \
		else \
			printf '  \033[31mx\033[0m 없음: %s\n' "$$f"; FAIL=$$((FAIL+1)); \
		fi; \
	done; \
	\
	PY_FILE="$(TMPL_DIR)/$(AGENT)-app.py"; \
	if [ -f "$$PY_FILE" ]; then \
		if $(PY) -m py_compile "$$PY_FILE" 2>/dev/null; then \
			printf '  \033[32mv\033[0m Python 문법 OK\n'; PASS=$$((PASS+1)); \
		else \
			printf '  \033[31mx\033[0m Python 문법 오류\n'; FAIL=$$((FAIL+1)); \
		fi; \
		if grep -q "^router\s*=" "$$PY_FILE" 2>/dev/null; then \
			printf '  \033[32mv\033[0m router 변수 선언 확인\n'; PASS=$$((PASS+1)); \
		else \
			printf '  \033[31mx\033[0m router 변수 없음 (export: router = APIRouter(...))\n'; FAIL=$$((FAIL+1)); \
		fi; \
		if grep -q "^from __future__" "$$PY_FILE" 2>/dev/null; then \
			printf '  \033[31mx\033[0m from __future__ import 금지 (핫로드 소스 컴파일과 비호환)\n'; FAIL=$$((FAIL+1)); \
		else \
			printf '  \033[32mv\033[0m from __future__ 없음\n'; PASS=$$((PASS+1)); \
		fi; \
		if grep -qE "^from app\.(core\.deps|db|services)|^import app\." "$$PY_FILE" 2>/dev/null; then \
			printf '  \033[33m!\033[0m app.core.deps/app.db 직접 import 감지 — app.addon_sdk 사용 권장 (SeCMP 게시 심사 시 SDK-only)\n'; \
		else \
			printf '  \033[32mv\033[0m SDK-only import (app.addon_sdk)\n'; PASS=$$((PASS+1)); \
		fi; \
	fi; \
	\
	META_FILE="$(TMPL_DIR)/$(AGENT)-meta.json"; \
	if [ -f "$$META_FILE" ]; then \
		if (cd .. && uv run python -m app.services.addon_manifest "addon-agents/$$META_FILE"); then \
			PASS=$$((PASS+1)); \
		else \
			printf '  \033[31mx\033[0m manifest v2 검증 실패\n'; FAIL=$$((FAIL+1)); \
		fi; \
	fi; \
	\
	SQL_FILE="$(TMPL_DIR)/$(AGENT)-sql.sql"; \
	if [ -f "$$SQL_FILE" ] && grep -qi "CREATE TABLE" "$$SQL_FILE" 2>/dev/null; then \
		printf '  \033[32mv\033[0m SQL CREATE TABLE 구문 확인\n'; PASS=$$((PASS+1)); \
	elif [ -f "$$SQL_FILE" ]; then \
		printf '  \033[33m!\033[0m SQL에 CREATE TABLE 없음 (허용)\n'; \
	fi; \
	\
	TSX_FILE="$(TMPL_DIR)/$(AGENT)-front.tsx"; \
	if [ -f "$$TSX_FILE" ] && grep -q "export default" "$$TSX_FILE" 2>/dev/null; then \
		printf '  \033[32mv\033[0m export default 확인\n'; PASS=$$((PASS+1)); \
	elif [ -f "$$TSX_FILE" ]; then \
		printf '  \033[31mx\033[0m export default 없음\n'; FAIL=$$((FAIL+1)); \
	fi; \
	\
	if [ -f "$(ZIP_OUT)" ]; then \
		if (cd .. && uv run python -c "import zipfile,sys; \
from app.services.addon_validator import scan_zip, is_worker_package; \
zf=zipfile.ZipFile('addon-agents/$(ZIP_OUT)'); \
r=scan_zip(zf, 'worker' if is_worker_package('$(AGENT)') else 'addon'); \
print('  scan:', r.summary()); sys.exit(1 if r.blocked else 0)"); then \
			printf '  \033[32mv\033[0m scan_zip 통과\n'; PASS=$$((PASS+1)); \
		else \
			printf '  \033[31mx\033[0m scan_zip CRITICAL 차단\n'; FAIL=$$((FAIL+1)); \
		fi; \
	fi; \
	\
	printf '\n  결과: \033[32m%d\033[0m 통과 / \033[31m%d\033[0m 실패\n\n' "$$PASS" "$$FAIL"; \
	[ $$FAIL -eq 0 ]

# ─── publish ──────────────────────────────────────────────────────────────────
publish:
	@printf '>>> [publish] Agent '\''$(AGENT)'\'' zip 패키징...\n'
	@APP="$(TMPL_DIR)/$(AGENT)-app.py"; \
	META="$(TMPL_DIR)/$(AGENT)-meta.json"; \
	MISSING=0; \
	for f in "$$APP" "$$META"; do \
		[ -f "$$f" ] || { printf '  ERROR: %s 없음 (manifest v2 필수)\n' "$$f"; MISSING=$$((MISSING+1)); }; \
	done; \
	[ $$MISSING -eq 0 ] || exit 1; \
	[ -f "$(ZIP_OUT)" ] && rm -f "$(ZIP_OUT)"; \
	zip -j "$(ZIP_OUT)" "$(TMPL_DIR)"/* 1>/dev/null && \
	printf '\n  \033[32mv\033[0m 생성: $(ZIP_OUT)\n' && \
	ls -lh "$(ZIP_OUT)" | awk '{printf "  크기: %s\n", $$5}' && \
	printf '\n  업로드 방법:\n' && \
	printf '    에이전트 관리 → Addon 에이전트 등록 → $(AGENT).zip 선택\n\n'

# ─── clean ────────────────────────────────────────────────────────────────────
clean:
	@printf '>>> [clean] Agent '\''$(AGENT)'\'' 파일 삭제...\n'
	@if [ -d "$(TMPL_DIR)" ]; then \
		rm -rf "$(TMPL_DIR)"; printf '  삭제: $(TMPL_DIR)\n'; \
	fi
	@if [ -f "$(ZIP_OUT)" ]; then \
		rm -f "$(ZIP_OUT)"; printf '  삭제: $(ZIP_OUT)\n'; \
	fi
	@printf '  완료\n'
