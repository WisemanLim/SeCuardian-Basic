"""Standalone Agent FastAPI 앱 — A2A/MCP 엔드포인트 포함 (F12).

실행:
    # local (기본): .env.local 자동 로드
    AGENT_KEY=example uv run uvicorn standalone.standalone_app:app --port 8001

    # dev/staging/prod: ENV 지정 → .env.{ENV} 로드
    ENV=dev AGENT_KEY=example uv run uvicorn standalone.standalone_app:app --port 8001

env 파일 우선순위:
    1. 쉘에서 이미 설정된 환경변수 (override)
    2. .env.{ENV} 파일 값
    3. config.py 기본값
"""
import os
import sys

# standalone 폴더 기준으로 프로젝트 루트를 sys.path에 추가
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ENV 미설정 시 local 기본값 — .env.local 을 로드하게 됨
os.environ.setdefault("ENV", "local")
os.environ.setdefault("AGENT_STANDALONE", "true")

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.routers import router_a2a, router_auth, router_mcp


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.db import apply_column_migrations, run_migrations
    await run_migrations()
    await apply_column_migrations()
    yield


app = FastAPI(
    title=f"Standalone Agent — {settings.agent_key or 'example'}",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# A2A + MCP 엔드포인트 항상 포함 (Standalone 모드 전용)
app.include_router(router_a2a.router)
app.include_router(router_mcp.router)
# auth: A2A Task 생성/조회용 Bearer 토큰 발급 (README §4-3)
app.include_router(router_auth.router)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "agent": settings.agent_key or "example",
        "mode": "standalone",
        "env": settings.env,
        "base_url": settings.agent_base_url,
        "protocols": ["a2a", "mcp"],
    }
