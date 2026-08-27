"""Setup Wizard API — 최초 설치 흐름 (F6).

단계: status → supervisor → llm-provider → complete
모든 엔드포인트는 인증 불필요 (setup 완료 전 상태).
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.security import hash_password
from app.db import execute_write, fetch_one, _PH

router = APIRouter(prefix="/api/setup", tags=["setup"])


@router.get("/status")
async def get_status():
    """Supervisor 존재 여부 + Setup 완료 여부 반환."""
    supervisor = await fetch_one(
        "SELECT user_id FROM tbl_users WHERE role = 'supervisor' LIMIT 1"
    )
    setting = await fetch_one(
        f"SELECT value FROM tbl_settings WHERE key = {_PH}", ("setup_completed",)
    )
    return {
        "has_supervisor": supervisor is not None,
        "completed": setting is not None and setting.get("value") == "true",
    }


class SupervisorCreate(BaseModel):
    user_id: str
    username: str
    password: str
    email: str = ""


@router.post("/supervisor", status_code=201)
async def create_supervisor(body: SupervisorCreate):
    """최초 Supervisor 계정 생성 — supervisor 이미 존재하면 409."""
    existing_supervisor = await fetch_one(
        "SELECT user_id FROM tbl_users WHERE role = 'supervisor' LIMIT 1"
    )
    if existing_supervisor:
        raise HTTPException(status_code=409, detail="Supervisor already exists")
    dup = await fetch_one(
        f"SELECT user_id FROM tbl_users WHERE user_id = {_PH}", (body.user_id,)
    )
    if dup:
        raise HTTPException(status_code=409, detail="user_id already taken")
    await execute_write(
        f"INSERT INTO tbl_users (user_id, username, email, password, role) "
        f"VALUES ({_PH},{_PH},{_PH},{_PH},{_PH})",
        (body.user_id, body.username, body.email, hash_password(body.password), "supervisor"),
    )
    return {"message": "Supervisor created", "user_id": body.user_id}


class LLMProviderUpdate(BaseModel):
    orchestrator_model: str = "claude-sonnet-4-6"
    domain_agent_model: str = "claude-haiku-4-5-20251001"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "mistral"
    fallback_enabled: bool = True


@router.put("/llm-provider")
async def set_llm_provider(body: LLMProviderUpdate):
    """LLM Provider 설정을 tbl_settings에 저장."""
    items = [
        ("orchestrator_model", body.orchestrator_model, "Orchestrator LLM 모델"),
        ("domain_agent_model", body.domain_agent_model, "Domain Agent LLM 모델"),
        ("ollama_base_url", body.ollama_base_url, "Ollama 서버 주소"),
        ("ollama_model", body.ollama_model, "Ollama 기본 모델"),
        ("fallback_enabled", str(body.fallback_enabled).lower(), "LLM Fallback 활성화"),
    ]
    for key, value, description in items:
        await execute_write(
            f"INSERT INTO tbl_settings (key, value, description) VALUES ({_PH},{_PH},{_PH}) "
            f"ON CONFLICT(key) DO UPDATE SET value=excluded.value, description=excluded.description",
            (key, value, description),
        )
    return {"message": "LLM provider settings saved"}


class AdminCreate(BaseModel):
    user_id: str
    username: str
    password: str
    email: str = ""


@router.post("/admin", status_code=201)
async def create_admin(body: AdminCreate):
    """Administrator 계정 생성 (선택 단계)."""
    dup = await fetch_one(
        f"SELECT user_id FROM tbl_users WHERE user_id = {_PH}", (body.user_id,)
    )
    if dup:
        raise HTTPException(status_code=409, detail="user_id already taken")
    await execute_write(
        f"INSERT INTO tbl_users (user_id, username, email, password, role) "
        f"VALUES ({_PH},{_PH},{_PH},{_PH},{_PH})",
        (body.user_id, body.username, body.email, hash_password(body.password), "admin"),
    )
    return {"message": "Admin created", "user_id": body.user_id}


class UserCreate(BaseModel):
    user_id: str
    username: str
    password: str
    email: str = ""
    role: str = "user"


@router.post("/user", status_code=201)
async def create_user(body: UserCreate):
    """일반 User 계정 생성 (선택 단계)."""
    if body.role not in ("user", "viewer"):
        raise HTTPException(status_code=400, detail="role은 user 또는 viewer만 허용")
    dup = await fetch_one(
        f"SELECT user_id FROM tbl_users WHERE user_id = {_PH}", (body.user_id,)
    )
    if dup:
        raise HTTPException(status_code=409, detail="user_id already taken")
    await execute_write(
        f"INSERT INTO tbl_users (user_id, username, email, password, role) "
        f"VALUES ({_PH},{_PH},{_PH},{_PH},{_PH})",
        (body.user_id, body.username, body.email, hash_password(body.password), body.role),
    )
    return {"message": "User created", "user_id": body.user_id}


@router.post("/complete")
async def complete_setup():
    """Setup Wizard 완료 마킹 — setup_completed = true."""
    await execute_write(
        f"INSERT INTO tbl_settings (key, value, description) VALUES ({_PH},{_PH},{_PH}) "
        f"ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        ("setup_completed", "true", "Setup Wizard 완료"),
    )
    return {"message": "Setup completed", "setup_completed": True}
