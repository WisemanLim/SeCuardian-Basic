-- =============================================================================
-- Board Agent — Database Schema (PostgreSQL)
-- =============================================================================
-- AgentName: Board
-- Tables: tbl_board_posts, tbl_board_comments
-- Soft-delete 방식: is_deleted = TRUE 로 처리 (실제 행 삭제 안 함)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- tbl_board_posts (게시글)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tbl_board_posts (
    id          SERIAL PRIMARY KEY,
    title       VARCHAR(500) NOT NULL,
    content     TEXT NOT NULL,
    author_id   VARCHAR(50)  NOT NULL,
    author_name VARCHAR(100),
    is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_board_posts_author   ON tbl_board_posts (author_id);
CREATE INDEX IF NOT EXISTS idx_board_posts_deleted  ON tbl_board_posts (is_deleted);
CREATE INDEX IF NOT EXISTS idx_board_posts_created  ON tbl_board_posts (created_at DESC);


-- -----------------------------------------------------------------------------
-- tbl_board_comments (댓글)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tbl_board_comments (
    id          SERIAL PRIMARY KEY,
    post_id     INTEGER      NOT NULL REFERENCES tbl_board_posts (id) ON DELETE CASCADE,
    content     TEXT         NOT NULL,
    author_id   VARCHAR(50)  NOT NULL,
    author_name VARCHAR(100),
    is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_board_comments_post    ON tbl_board_comments (post_id);
CREATE INDEX IF NOT EXISTS idx_board_comments_author  ON tbl_board_comments (author_id);
CREATE INDEX IF NOT EXISTS idx_board_comments_deleted ON tbl_board_comments (is_deleted);
