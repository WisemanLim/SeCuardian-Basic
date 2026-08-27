-- secuardian — DB 스키마 초기화 (idempotent, SQLite)

CREATE TABLE IF NOT EXISTS tbl_users (
    serial       INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      VARCHAR(50)  NOT NULL UNIQUE,
    username     VARCHAR(50),
    email        VARCHAR(100),
    password     VARCHAR(200) NOT NULL,
    role         VARCHAR(20)  NOT NULL DEFAULT 'user',
    status       VARCHAR(20)  NOT NULL DEFAULT 'active',
    custom_instructions TEXT,
    preferred_lang VARCHAR(10),
    totp_secret  TEXT,
    totp_enabled INTEGER      NOT NULL DEFAULT 0,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP
);

-- Agent 활성화 설정 (F8)
CREATE TABLE IF NOT EXISTS tbl_agent_config (
    agent_key    VARCHAR(50)  PRIMARY KEY,
    agent_name   VARCHAR(100) NOT NULL,
    is_enabled   INTEGER      NOT NULL DEFAULT 1,
    is_required  INTEGER      NOT NULL DEFAULT 0,
    model        TEXT,
    system_prompt TEXT,
    description  TEXT,
    description_en TEXT,
    descriptions TEXT,
    agent_names  TEXT,
    disabled_reason TEXT,
    disabled_reason_en TEXT,
    nav_group    VARCHAR(50),
    sort_order   INTEGER      NOT NULL DEFAULT 0,
    updated_at   TIMESTAMP
);

-- Addon Agent 등록 (F4 + F22)
CREATE TABLE IF NOT EXISTS tbl_addon_agents (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_key    VARCHAR(50)  NOT NULL UNIQUE,
    agent_name   VARCHAR(100) NOT NULL,
    router_path  VARCHAR(500),
    api_prefix   VARCHAR(100) NOT NULL,
    sql_path     VARCHAR(500),
    has_app      INTEGER      NOT NULL DEFAULT 0,
    has_front    INTEGER      NOT NULL DEFAULT 0,
    agent_type   TEXT         NOT NULL DEFAULT 'app',
    meta_json    TEXT,
    is_builtin   INTEGER      NOT NULL DEFAULT 0,
    is_active    INTEGER      NOT NULL DEFAULT 1,
    uploaded_by  VARCHAR(50),
    uploaded_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version        TEXT DEFAULT '1.0.0',
    checksum       TEXT,
    manifest_json  TEXT,
    installed_from TEXT,
    scan_result    TEXT
);

-- Addon 파이썬 의존성 설치 이력 (E2, PRD B-7)
CREATE TABLE IF NOT EXISTS tbl_addon_dependencies (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_key    TEXT NOT NULL,
    package      TEXT NOT NULL,
    spec         TEXT,
    installed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 시스템 설정 (F9, key-value)
CREATE TABLE IF NOT EXISTS tbl_settings (
    key          VARCHAR(100) PRIMARY KEY,
    value        TEXT,
    description  VARCHAR(200),
    updated_at   TIMESTAMP
);

-- LLM 호출 사용량 원장 (R19-3 Metering)
CREATE TABLE IF NOT EXISTS tbl_llm_usage (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      VARCHAR(50),
    agent_key    VARCHAR(50),
    provider     VARCHAR(20)  NOT NULL,
    model        VARCHAR(100) NOT NULL,
    task         VARCHAR(20)  NOT NULL,
    tokens_in    INTEGER      NOT NULL DEFAULT 0,
    tokens_out   INTEGER      NOT NULL DEFAULT 0,
    latency_ms   INTEGER      NOT NULL DEFAULT 0,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_llm_usage_created ON tbl_llm_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_llm_usage_model ON tbl_llm_usage(model);

-- Agent Registry — 외부 Standalone Agent (F12 + F23)
CREATE TABLE IF NOT EXISTS tbl_agent_registry (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_key          VARCHAR(50)  NOT NULL UNIQUE,
    agent_name         VARCHAR(100) NOT NULL,
    protocol           VARCHAR(10)  NOT NULL DEFAULT 'a2a',
    agent_card_url     VARCHAR(500),
    mcp_endpoint       VARCHAR(500),
    auth_token         TEXT,
    agent_type         TEXT         NOT NULL DEFAULT 'service',
    capabilities_json  TEXT,
    agent_card_json    TEXT,
    lifecycle_state    TEXT         NOT NULL DEFAULT 'active',
    health_score       REAL         NOT NULL DEFAULT 1.0,
    last_heartbeat_at  TIMESTAMP,
    lease_expires_at   TIMESTAMP,
    is_active          INTEGER      NOT NULL DEFAULT 1,
    last_seen_at       TIMESTAMP,
    created_by         VARCHAR(50),
    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Addon Agent Capability 인덱스 (F23)
CREATE TABLE IF NOT EXISTS tbl_addon_agent_capabilities (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_key      VARCHAR(50)  NOT NULL,
    capability_key VARCHAR(100) NOT NULL,
    verb           VARCHAR(50)  NOT NULL,
    domain         VARCHAR(200) NOT NULL,
    description    TEXT,
    input_schema   TEXT,
    output_schema  TEXT,
    qos_json       TEXT,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(agent_key, capability_key)
);

-- MCP Proxy 설정 (F12 MCP)
CREATE TABLE IF NOT EXISTS tbl_mcp_configs (
    agent_key    VARCHAR(50)  PRIMARY KEY,
    port         INTEGER,
    extra_args   TEXT,
    is_enabled   INTEGER      NOT NULL DEFAULT 1,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP
);

-- 감사 로그
CREATE TABLE IF NOT EXISTS tbl_audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    VARCHAR(50),
    action     VARCHAR(100) NOT NULL,
    target     VARCHAR(200),
    detail     TEXT,
    ip_address VARCHAR(50),
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 사용자별 대화 세션 (R18-2)
CREATE TABLE IF NOT EXISTS tbl_chat_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_key VARCHAR(50)  NOT NULL,
    user_id     VARCHAR(50)  NOT NULL,
    agent_key   VARCHAR(50),
    title       VARCHAR(200),
    model       VARCHAR(100),
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP,
    UNIQUE(user_id, session_key)
);

-- 대화 메시지 (R18-2)
CREATE TABLE IF NOT EXISTS tbl_chat_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER      NOT NULL,
    role        VARCHAR(20)  NOT NULL,
    content     TEXT         NOT NULL,
    model       VARCHAR(100),
    latency_ms  INTEGER,
    tokens_in   INTEGER,
    tokens_out  INTEGER,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON tbl_chat_messages(session_id);

-- 응답 만족도 피드백 (R18-3, rating: bad|fine|good)
CREATE TABLE IF NOT EXISTS tbl_chat_feedback (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id  INTEGER      NOT NULL,
    user_id     VARCHAR(50)  NOT NULL,
    rating      VARCHAR(10)  NOT NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP,
    UNIQUE(message_id, user_id)
);

-- 관리자(운영자) 건의 (R18-4)
CREATE TABLE IF NOT EXISTS tbl_suggestions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     VARCHAR(50)  NOT NULL,
    title       VARCHAR(200) NOT NULL,
    content     TEXT         NOT NULL,
    status      VARCHAR(20)  NOT NULL DEFAULT 'new',
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
