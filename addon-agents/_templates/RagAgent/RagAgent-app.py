"""RagAgent — 문서 임베딩 + 벡터 검색 기반 RAG/Knowledge Agent.

마운트 경로: /api/addon/ragagent/...
엔드포인트:
  POST /ingest          문서 업로드 + 청킹 + 임베딩
  GET  /documents       업로드된 문서 목록
  DELETE /documents/{id} 문서 삭제
  POST /search          벡터 유사도 검색 (키워드 폴백)
  POST /qa              RAG 기반 Q&A (SSE 스트리밍)
"""
import json
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.addon_sdk import PH, execute_insert, execute_write, fetch_all, fetch_one, get_current_user, require_role

router = APIRouter(tags=["rag-agent"])


# ─── 임베딩 함수 (커스터마이즈 대상) ─────────────────────────────────────────────

async def _embed(text: str) -> list[float]:
    """[CUSTOMIZE] 텍스트를 임베딩 벡터로 변환합니다.
    - local: Ollama nomic-embed-text
    - cloud: OpenAI text-embedding-3-small
    기본값: 단어 빈도 기반 단순 벡터 (프로토타입용)
    """
    # 프로토타입: 실제 서비스에서는 Ollama/OpenAI 임베딩으로 교체
    words = text.lower().split()
    freq: dict[str, int] = {}
    for w in words:
        freq[w] = freq.get(w, 0) + 1
    # 고정 차원 128 벡터 (해시 기반)
    vec = [0.0] * 128
    for w, cnt in freq.items():
        idx = hash(w) % 128
        vec[idx] += cnt
    norm = (sum(x * x for x in vec) ** 0.5) or 1.0
    return [x / norm for x in vec]


def _cosine_sim(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = (sum(x * x for x in a) ** 0.5) or 1.0
    nb = (sum(x * x for x in b) ** 0.5) or 1.0
    return dot / (na * nb)


# ─── 문서 인제스트 ────────────────────────────────────────────────────────────

async def _store_document(filename: str, content: str, user_sub: str) -> dict:
    """문서를 청킹·임베딩 후 저장하는 공통 로직."""
    doc_id = await execute_insert(
        f"INSERT INTO tbl_ragagent_documents (filename, content, uploaded_by) "
        f"VALUES ({PH},{PH},{PH})",
        (filename, content[:10000], user_sub),
    )

    # 청킹 (500자 단위, 50자 오버랩)
    chunk_size, overlap = 500, 50
    chunks = []
    i = 0
    while i < len(content):
        chunk = content[i:i + chunk_size]
        chunks.append(chunk)
        i += chunk_size - overlap

    # 임베딩 저장
    for idx, chunk in enumerate(chunks):
        vec = await _embed(chunk)
        await execute_write(
            f"INSERT INTO tbl_ragagent_chunks (doc_id, chunk_index, content, embedding_json) "
            f"VALUES ({PH},{PH},{PH},{PH})",
            (doc_id, idx, chunk, json.dumps(vec)),
        )

    return {"doc_id": doc_id, "filename": filename, "chunks": len(chunks)}


@router.post("/ingest", status_code=201)
async def ingest_document(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    """문서 파일을 업로드하고 청킹·임베딩 후 저장합니다 (multipart)."""
    content = (await file.read()).decode("utf-8", errors="ignore")
    filename = file.filename or "unknown"
    return await _store_document(filename, content, user.get("sub", ""))


class IngestTextRequest(BaseModel):
    content: str
    filename: str = "manual-input.txt"


@router.post("/ingest-text", status_code=201)
async def ingest_text(body: IngestTextRequest, user: dict = Depends(get_current_user)):
    """텍스트 본문을 직접 청킹·임베딩 후 저장합니다 (JSON — AI 어시스턴트용)."""
    return await _store_document(body.filename, body.content, user.get("sub", ""))


@router.get("/documents")
async def list_documents(user: dict = Depends(get_current_user)):
    rows = await fetch_all(
        "SELECT id, filename, uploaded_by, created_at FROM tbl_ragagent_documents ORDER BY created_at DESC"
    )
    return {"documents": rows, "total": len(rows)}


@router.delete("/documents/{doc_id}")
async def delete_document(
    doc_id: int,
    user: dict = Depends(require_role("supervisor", "admin")),
):
    await execute_write(f"DELETE FROM tbl_ragagent_chunks WHERE doc_id = {PH}", (doc_id,))
    await execute_write(f"DELETE FROM tbl_ragagent_documents WHERE id = {PH}", (doc_id,))
    return {"message": f"문서 {doc_id} 삭제 완료"}


# ─── 검색 ────────────────────────────────────────────────────────────────────

class SearchRequest(BaseModel):
    query: str
    top_k: int = 5


@router.post("/search")
async def search(body: SearchRequest, user: dict = Depends(get_current_user)):
    """쿼리와 유사한 문서 청크를 코사인 유사도로 검색합니다."""
    query_vec = await _embed(body.query)
    chunks = await fetch_all(
        "SELECT c.id, c.doc_id, c.content, c.embedding_json, d.filename "
        "FROM tbl_ragagent_chunks c "
        "JOIN tbl_ragagent_documents d ON c.doc_id = d.id"
    )
    scored = []
    for chunk in chunks:
        try:
            vec = json.loads(chunk["embedding_json"])
            sim = _cosine_sim(query_vec, vec)
            scored.append({**chunk, "score": round(sim, 4), "embedding_json": None})
        except Exception:
            pass
    scored.sort(key=lambda x: x["score"], reverse=True)
    return {"results": scored[: body.top_k], "query": body.query}


# ─── Q&A (RAG) ───────────────────────────────────────────────────────────────

class QARequest(BaseModel):
    question: str
    top_k: int = 3


@router.post("/qa")
async def qa(body: QARequest, user: dict = Depends(get_current_user)):
    """RAG 기반 Q&A — 관련 청크 검색 후 SSE 스트리밍 답변."""
    # 관련 청크 검색
    query_vec = await _embed(body.question)
    chunks = await fetch_all(
        "SELECT c.content, c.embedding_json, d.filename "
        "FROM tbl_ragagent_chunks c "
        "JOIN tbl_ragagent_documents d ON c.doc_id = d.id"
    )
    scored = []
    for chunk in chunks:
        try:
            vec = json.loads(chunk["embedding_json"])
            sim = _cosine_sim(query_vec, vec)
            scored.append({"content": chunk["content"], "filename": chunk["filename"], "score": sim})
        except Exception:
            pass
    scored.sort(key=lambda x: x["score"], reverse=True)
    top_chunks = scored[: body.top_k]

    context = "\n\n".join(f"[{c['filename']}]\n{c['content']}" for c in top_chunks)

    async def _gen():
        import json as _json
        yield f"data: {_json.dumps({'event': 'context', 'sources': [{'filename': c['filename'], 'score': round(c['score'], 4)} for c in top_chunks]})}\n\n"

        # [CUSTOMIZE] LLM 호출로 교체
        answer = (
            f"질문: {body.question}\n\n"
            f"참고 문서를 기반으로 답변합니다.\n\n"
            f"[참고 컨텍스트]\n{context[:500]}...\n\n"
            "실제 서비스에서는 이 부분을 LLM(Anthropic/OpenAI) 호출로 교체하세요."
        )
        yield f"data: {_json.dumps({'event': 'answer', 'text': answer})}\n\n"
        yield f"data: {_json.dumps({'event': 'done'})}\n\n"

    return StreamingResponse(_gen(), media_type="text/event-stream")
