-- =============================================================================
-- UserManager Agent — Database Schema (PostgreSQL/SQLite 호환)
-- =============================================================================
-- Table: tbl_addon_user
-- Features: 사용자 추가/수정/삭제/비밀번호 초기화

CREATE TABLE IF NOT EXISTS tbl_addon_user (
    id          SERIAL PRIMARY KEY,
    username    VARCHAR(50)  NOT NULL UNIQUE,
    full_name   VARCHAR(100),
    email       VARCHAR(150),
    role        VARCHAR(20)  NOT NULL DEFAULT 'user',
    status      VARCHAR(20)  NOT NULL DEFAULT 'active',
    password    VARCHAR(200) NOT NULL DEFAULT 'changeme123',
    notes       TEXT,
    is_deleted  BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_addon_user_username ON tbl_addon_user (username);
CREATE INDEX IF NOT EXISTS idx_addon_user_status   ON tbl_addon_user (status);
CREATE INDEX IF NOT EXISTS idx_addon_user_deleted  ON tbl_addon_user (is_deleted);
