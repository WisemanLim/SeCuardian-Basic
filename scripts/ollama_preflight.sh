#!/usr/bin/env bash
# Ollama 실행 확인 및 모델 준비 (local-all / up / dev-all 등에서 호출)
# Usage: ollama_preflight.sh [ENV_FILE]
#
# 실행 제어 / offline 내성:
#   - OLLAMA_ENABLED=false  → Ollama Docker 기동·모델 준비를 전부 스킵 (실행옵션, #5)
#   - OLLAMA_RUNTIME=cpu|gpu|mlx → 추론 런타임 선택
#       cpu(기본): CPU 추론
#       gpu      : Linux+NVIDIA — docker-compose.gpu.yml 병합해 호스트 GPU 예약
#       mlx      : macOS(Apple Silicon) — Docker(리눅스 VM)는 Metal/MLX 불가이므로
#                  네이티브 Ollama/MLX 를 호스트에서 구동(Docker Ollama 미기동), 안내만
#   - 인터넷 미연결 시 이미지 pull·모델 pull 실패가 startup 을 막지 않도록
#     네트워크 실패는 모두 경고 후 exit 0 (비차단). 앱은 런타임에 LLM 폴백 처리. (#1)
set -uo pipefail

ENV_FILE="${1:-.env.local}"

# 우선순위: 프로세스 환경변수 > env 파일 (앱 config 의 os.environ > .env 와 일치).
# 예) `OLLAMA_RUNTIME=mlx make prod-all` 이 .env 의 값을 덮어쓰도록.
_read_env() {
    local v="${!1-}"
    if [ -n "${v:-}" ]; then printf '%s\n' "$v"; return; fi
    grep "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'" | xargs || true
}
_lower() { echo "$1" | tr '[:upper:]' '[:lower:]'; }

# ── 0. Ollama 실행옵션 (OLLAMA_ENABLED) ──────────────────────────────────────
# 미설정/빈값이면 기본 활성(true) — 하위 호환. false/0/no 면 전체 스킵.
OLLAMA_ENABLED="$(_read_env OLLAMA_ENABLED)"
OLLAMA_ENABLED="${OLLAMA_ENABLED:-true}"
case "$(_lower "$OLLAMA_ENABLED")" in
    false|0|no|off)
        echo "⏭️  OLLAMA_ENABLED=${OLLAMA_ENABLED} — Ollama Docker/모델 준비 스킵"
        exit 0
        ;;
esac

# 런타임 선택 (cpu|gpu|mlx)
OLLAMA_RUNTIME="$(_lower "$(_read_env OLLAMA_RUNTIME)")"
OLLAMA_RUNTIME="${OLLAMA_RUNTIME:-cpu}"
UNAME_S="$(uname -s 2>/dev/null || echo unknown)"
UNAME_M="$(uname -m 2>/dev/null || echo unknown)"

# OLLAMA_PORT: env 파일에서 읽기, 없으면 기본값 11434
OLLAMA_PORT="$(_read_env OLLAMA_PORT)"
OLLAMA_PORT="${OLLAMA_PORT:-11434}"
OLLAMA_URL="http://localhost:${OLLAMA_PORT}"

# compose 호출 프리픽스 — gpu 런타임이면 GPU 오버레이 병합
_COMPOSE=(docker compose --env-file "$ENV_FILE")
if [ "$OLLAMA_RUNTIME" = "gpu" ]; then
    _COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.gpu.yml --env-file "$ENV_FILE")
fi

echo "🧩 OLLAMA_RUNTIME=${OLLAMA_RUNTIME} (host: ${UNAME_S}/${UNAME_M})"

# ── 1. Ollama 실행 확인 ───────────────────────────────────────────────────────
if curl -sf "${OLLAMA_URL}/api/tags" >/dev/null 2>&1; then
    echo "✅ Ollama :${OLLAMA_PORT} 이미 실행 중 (네이티브/기존 컨테이너) — 기동 스킵"
elif lsof -i ":${OLLAMA_PORT}" -sTCP:LISTEN -t >/dev/null 2>&1; then
    # 포트 점유는 실제 충돌 → 차단 (offline 과 무관)
    echo "❌ 포트 ${OLLAMA_PORT}이 Ollama 아닌 다른 프로세스에 사용 중"
    lsof -i ":${OLLAMA_PORT}" -sTCP:LISTEN | tail -n +2
    exit 1
elif [ "$OLLAMA_RUNTIME" = "mlx" ]; then
    # macOS Metal/MLX 가속 — Docker(리눅스 VM)는 Apple GPU 접근 불가 → 네이티브 필요
    echo "🍎 OLLAMA_RUNTIME=mlx — Docker 는 macOS GPU(Metal/MLX) 를 사용할 수 없어 Docker Ollama 를 기동하지 않습니다."
    echo "    호스트에서 네이티브 LLM 서버(:${OLLAMA_PORT}) 를 구동하세요:"
    echo "      • Ollama(Metal): brew install ollama && OLLAMA_HOST=0.0.0.0:${OLLAMA_PORT} ollama serve"
    echo "      • MLX(mlx-lm / LM Studio): Ollama·OpenAI 호환 API 를 :${OLLAMA_PORT} 로 노출"
    echo "    앱은 OLLAMA_BASE_URL(host.docker.internal:${OLLAMA_PORT})로 접속합니다. (미구동 시 Claude API 폴백)"
    exit 0
else
    if [ "$OLLAMA_RUNTIME" = "cpu" ] && [ "$UNAME_S" = "Darwin" ] && [ "$UNAME_M" = "arm64" ]; then
        echo "⚠️  macOS(Apple Silicon)에서 Docker Ollama 는 CPU 전용입니다(Metal 미사용)."
        echo "    GPU(Metal)/MLX 가속을 원하면 OLLAMA_RUNTIME=mlx + 네이티브 Ollama 를 사용하세요."
    fi
    echo "🐳 Ollama Docker Compose 기동 중 (runtime=${OLLAMA_RUNTIME})..."
    # 이미지 미보유 + 인터넷 미연결, 또는 GPU 툴킷 부재 시 실패 → startup 을 막지 않고 경고 후 스킵
    if ! "${_COMPOSE[@]}" up -d ollama 2>/tmp/ollama_up.err; then
        echo "⚠️  Ollama Docker 기동 실패 (오프라인/이미지 미보유/GPU 툴킷 부재 가능) — 스킵하고 계속 진행"
        echo "    $(tail -n 2 /tmp/ollama_up.err 2>/dev/null | tr '\n' ' ')"
        if [ "$OLLAMA_RUNTIME" = "gpu" ]; then
            echo "    ℹ️  GPU: Linux + NVIDIA 드라이버 + NVIDIA Container Toolkit(nvidia-ctk) 필요."
        fi
        echo "    ℹ️  AI 응답은 Claude API 또는 네이티브 Ollama 로 폴백됩니다."
        exit 0
    fi
    echo "⏳ Ollama 준비 대기 중..."
    for i in $(seq 1 30); do
        if curl -sf "${OLLAMA_URL}/api/tags" >/dev/null 2>&1; then
            echo "✅ Ollama 준비 완료"
            break
        fi
        if [ "$i" -eq 30 ]; then
            echo "⚠️  Ollama 시작 시간 초과 (60초) — 스킵하고 계속 진행"
            exit 0
        fi
        sleep 2
    done
fi

# ── 2. 모델 확인 및 다운로드 ──────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
    echo "⚠️  $ENV_FILE 없음 — 모델 확인 스킵"
    exit 0
fi

OLLAMA_MODEL="$(_read_env OLLAMA_MODEL)"

if [ -z "$OLLAMA_MODEL" ]; then
    echo "ℹ️  OLLAMA_MODEL 미설정 — 모델 확인 스킵"
    exit 0
fi

echo "🔍 모델 확인: ${OLLAMA_MODEL}"

MODEL_READY=0
TAGS_JSON=$(curl -sf "${OLLAMA_URL}/api/tags" 2>/dev/null || echo '{"models":[]}')
if echo "$TAGS_JSON" | grep -q "\"name\":\"${OLLAMA_MODEL}"; then
    echo "✅ 모델 ${OLLAMA_MODEL} 사용 가능"
    MODEL_READY=1
else
    echo "⬇️  모델 ${OLLAMA_MODEL} 없음 — 다운로드 중 (시간 소요)..."
    # 인터넷 미연결 시 pull 실패 → startup 을 막지 않고 경고 후 계속 (비차단, #1)
    if command -v ollama >/dev/null 2>&1; then
        _pull_cmd=(ollama pull "${OLLAMA_MODEL}")
    else
        _pull_cmd=("${_COMPOSE[@]}" exec ollama ollama pull "${OLLAMA_MODEL}")
    fi
    if "${_pull_cmd[@]}"; then
        echo "✅ 모델 ${OLLAMA_MODEL} 다운로드 완료"
        MODEL_READY=1
    else
        echo "⚠️  모델 ${OLLAMA_MODEL} 다운로드 실패 (오프라인 가능) — 스킵하고 계속 진행"
        echo "    ℹ️  로컬 LLM 미사용 시 Claude API 로 응답합니다. 온라인 복구 후 'make up' 재실행하면 자동 준비됩니다."
    fi
fi

# ── 3. 모델 예열(warmup) ──────────────────────────────────────────────────────
# (재)구동 후 첫 토큰 콜드스타트 지연 방지 — "hi" 선요청으로 모델을 메모리에 상주(keep_alive).
if [ "$MODEL_READY" = "1" ]; then
    echo "🔥 Ollama 모델 예열(warmup) 중..."
    if curl -sf -m 90 "${OLLAMA_URL}/api/generate" \
        -H 'Content-Type: application/json' \
        -d "{\"model\":\"${OLLAMA_MODEL}\",\"prompt\":\"hi\",\"stream\":false,\"keep_alive\":-1}" \
        >/dev/null 2>&1; then
        echo "✅ 예열 완료 — 첫 응답 지연 방지"
    else
        echo "⚠️  예열 스킵(비차단) — 앱 백그라운드 예열이 이어서 처리합니다."
    fi
fi

exit 0
