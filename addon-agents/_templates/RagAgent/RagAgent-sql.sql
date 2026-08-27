-- RagAgent 테이블 스키마 (F22 RAG Agent)
-- tbl_ragagent_documents: 업로드된 원본 문서
-- tbl_ragagent_chunks: 청킹 + 임베딩 결과

CREATE TABLE IF NOT EXISTS tbl_ragagent_documents (
    id           SERIAL PRIMARY KEY,
    filename     VARCHAR(500) NOT NULL,
    content      TEXT,
    uploaded_by  VARCHAR(50),
    created_at   TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tbl_ragagent_chunks (
    id             SERIAL PRIMARY KEY,
    doc_id         INTEGER      NOT NULL REFERENCES tbl_ragagent_documents(id) ON DELETE CASCADE,
    chunk_index    INTEGER      NOT NULL DEFAULT 0,
    content        TEXT         NOT NULL,
    embedding_json TEXT,
    created_at     TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ragagent_chunks_doc_id ON tbl_ragagent_chunks(doc_id);
