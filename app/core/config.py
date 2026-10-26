"""secuardian-basic — settings (env-driven)."""
import os
import re
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# 저장소 루트 (app/core/config.py → parents[2]). Addon 경로·SQL 경로의 CWD 비의존 기준 (PRD D1)
BASE_DIR = Path(__file__).resolve().parents[2]

_env_file = f".env.{os.getenv('ENV', 'local')}"

# Docker 컨테이너 내부에서 OLLAMA_BASE_URL 이 loopback(localhost/127.0.0.1)이면 호스트를 가리키도록
# host.docker.internal 로 치환. 외부 서버 IP 는 그대로 사용 (compose 는 env_file 값을 덮어쓰지 않음).
if os.path.exists("/.dockerenv") and os.environ.get("OLLAMA_BASE_URL"):
    os.environ["OLLAMA_BASE_URL"] = re.sub(
        r"^(https?://)(localhost|127\.0\.0\.1)(?=[:/]|$)", r"\1host.docker.internal",
        os.environ["OLLAMA_BASE_URL"],
    )


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_env_file, extra="ignore")

    app_name: str = "SeCuardian-Basic"  # [CUSTOMIZE]
    env: str = "local"
    core_version: str = "2.0.0"   # SeCuardian v2 플랫폼 계보 준용 — Addon requires.core 비교 대상 (SemVer)

    # Database
    database_url: str = "sqlite:///./local.db"

    # Redis
    redis_url: str = "redis://localhost:6379"

    # Auth
    jwt_secret_key: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60

    # Claude API (Orchestrator + Domain Agents)
    anthropic_api_key: str = ""
    orchestrator_model: str = "claude-sonnet-4-6"
    domain_agent_model: str = "claude-haiku-4-5-20251001"

    # OpenAI (선택)
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"

    # Google Gemini (선택)
    google_api_key: str = ""
    google_model: str = "gemini-1.5-flash"

    # Ollama (로컬 LLM 폴백)
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "mistral"
    # Ollama 예열(warmup): (재)구동 후 첫 토큰 콜드스타트 지연 방지 — "hi" 선요청으로 모델 상주
    ollama_warmup_enabled: bool = True
    ollama_warmup_interval: int = 240   # 초. 주기 재예열(ollama 독립 재구동 대응). 0 이하면 1회만

    # R19-1: 로컬 LLM 다중 백엔드 — 기본 provider 선택 (ollama|llamacpp|vllm)
    local_llm_provider: str = "ollama"
    llamacpp_base_url: str = "http://localhost:8180"   # llama.cpp server (OpenAI 호환)
    llamacpp_model: str = ""                            # 서버가 단일 모델 서빙 시 생략 가능
    vllm_base_url: str = "http://localhost:8100"        # vLLM OpenAI 호환 서버
    vllm_model: str = ""
    # R19-4: 히스토리 토큰 예산 (추정 토큰 초과 시 head/tail 축약) — 0 이하 = 무압축
    llm_context_budget: int = 8000
    # AI 어시스턴트 tool-call 최대 루프 횟수 (API 오류 자가수정 재시도 상한)
    llm_tool_max_rounds: int = 6

    # CORS — str 타입 유지: pydantic-settings가 list[str]에 json.loads를 시도해 crash하는 것 방지
    # 파싱은 main.py의 _parse_cors_origins()에서 수행 (JSON array OR 쉼표 구분 모두 지원)
    cors_origins: str = "http://localhost:4200"

    # Setup Wizard
    setup_completed: bool = False

    # Default admin (첫 구동 시 시드) — 미설정 시 생성 안 함
    default_admin_user_id: str | None = None
    default_admin_password: str | None = None

    # Agent 생성 UI 모드 제어 (R21): all(기본: scaffold+upload+marketplace) |
    # both(레거시: scaffold+upload) | scaffold | upload | marketplace | 쉼표 조합
    agent_create_mode: str = "all"

    # Marketplace 연동 (R21) — SeCuardian-Marketplace host 공개 카탈로그 접속
    marketplace_enabled: bool = True            # false 시 마켓플레이스 탭/API 비활성
    marketplace_host: str = "localhost"         # SeCMP host 주소
    # NOTE(D7): 8100 은 SeCMP(SeCuardian-Marketplace) 의 실제 BACKEND_PORT 기본값이다.
    # 로컬에서 vLLM(VLLM_PORT=8100, vllm_base_url) 과 같이 띄우면 포트가 충돌하므로
    # 둘 중 하나를 MARKETPLACE_PORT / VLLM_PORT 로 반드시 변경할 것.
    marketplace_port: int = 8100                # SeCMP backend 포트 (SeCMP BACKEND_PORT)
    marketplace_base_url: str = ""              # 지정 시 HOST/PORT 조합 대신 사용 (https 등)
    marketplace_api_key: str = ""               # SeCMP MARKETPLACE_HOST_API_KEY 와 일치 — 🔴 커밋 금지
    marketplace_tls_verify: bool = True         # 사설 CA 사용 시 false
    marketplace_verify_checksum: bool = True    # 다운로드 ZIP SHA256 검증 강제

    # ── Addon 경로 (기본: 저장소 루트 기준 절대 경로, env 로 오버라이드 — PRD D1) ──
    addon_deployed_path: str = str(BASE_DIR / "addon-agents" / "deployed")
    addon_templates_path: str = str(BASE_DIR / "addon-agents" / "_templates")
    addon_zip_path: str = str(BASE_DIR / "addon-agents" / "zip")
    addon_front_deployed_path: str = str(BASE_DIR / "front" / "src" / "pages" / "addon" / "deployed")
    addon_data_path: str = str(BASE_DIR / "data" / "addons")
    # Addon 프론트 반영 전략 (PRD D5): none(기본, 수동 재빌드) | compose(docker compose build web) | webhook(POST)
    addon_web_rebuild: str = "none"
    addon_web_rebuild_webhook_url: str = ""
    # Addon 파이썬 의존성 자동 설치 (manifest dependencies.python — PRD F6)
    addon_deps_install: bool = True
    addon_deps_find_links: str = ""    # 오프라인 wheel 디렉터리 (선택)
    addon_deps_allowlist: str = ""     # 쉼표 구분 패키지 허용목록. 빈 값 = 전체 허용
    addon_max_zip_mb: int = 10

    # MCP URL 외부 노출 호스트 (Docker/NAT 환경에서 host IP 명시)
    mcp_host: str = ""

    # MCP 서비스 인증 — Authorization 헤더 없는 MCP tools/call 처리 (#5)
    # 클라이언트가 x-api-key 헤더로 MCP_API_KEY 를 제시하면 MCP_AUTH_USER(tbl_users
    # 실계정)로 JWT(JWT_SECRET_KEY 서명)를 발급해 권한 부여. per-agent 는
    # tbl_mcp_configs.extra_args 의 `api_key:<키>` / `auth_user:<user_id>` 가 우선.
    mcp_api_key: str = ""    # MCP_API_KEY — 🔴 커밋 금지
    mcp_auth_user: str = ""  # MCP_AUTH_USER

    # Standalone Agent (F12)
    agent_standalone: bool = False
    agent_key: str = ""
    agent_port: int = 8001
    agent_base_url: str = "http://localhost:8001"
    agent_expose_protocol: str = ""  # "a2a,mcp" or ""


settings = Settings()
