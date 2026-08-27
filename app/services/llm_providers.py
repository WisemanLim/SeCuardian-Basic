"""로컬 LLM Provider 추상화 (R19-1) — Ollama / llama.cpp / vLLM.

공통 인터페이스 chat() 하나로 다중 백엔드를 지원한다.
- ollama   : 네이티브 /api/chat (prompt_eval_count/eval_count 미터링)
- llamacpp : llama.cpp server — OpenAI 호환 /v1/chat/completions
- vllm     : vLLM OpenAI 호환 서버 — /v1/chat/completions
tool_use 미지원 — 순수 텍스트 응답만 반환(기존 <api_call> 태그 방식 재사용).
"""
import logging
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger("uvicorn.error")

PROVIDERS = ("ollama", "llamacpp", "vllm")

# provider → (base_url 설정키, model 설정키, config 기본 base_url, config 기본 model)
_PROVIDER_KEYS = {
    "ollama": ("ollama_base_url", "ollama_model"),
    "llamacpp": ("llamacpp_base_url", "llamacpp_model"),
    "vllm": ("vllm_base_url", "vllm_model"),
}


def resolve_local(db: dict[str, str] | None = None) -> tuple[str, str, str]:
    """(provider, model, base_url) — db(tbl_settings 병합값) > config 기본값."""
    db = db or {}
    provider = (db.get("local_llm_provider") or settings.local_llm_provider or "ollama").lower()
    if provider not in PROVIDERS:
        provider = "ollama"
    base_key, model_key = _PROVIDER_KEYS[provider]
    model = db.get(model_key) or getattr(settings, model_key, "") or ""
    base_url = db.get(base_key) or getattr(settings, base_key, "") or ""
    return provider, model, base_url


def _to_str(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                parts.append(item.get("text") or str(item))
            else:
                parts.append(str(item))
        return " ".join(parts)
    return str(content)


def _norm_messages(messages: list[dict[str, Any]], system: str) -> list[dict[str, str]]:
    return [{"role": "system", "content": system}] + [
        {"role": m["role"], "content": _to_str(m["content"])}
        for m in messages
        if m.get("role") in ("user", "assistant")
    ]


async def _chat_ollama(
    msgs: list[dict], model: str, base_url: str, usage_out: dict | None
) -> str:
    payload = {"model": model, "messages": msgs, "stream": False}
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(f"{base_url}/api/chat", json=payload)
        resp.raise_for_status()
        data = resp.json()
        if usage_out is not None:
            usage_out["input_tokens"] = usage_out.get("input_tokens", 0) + int(data.get("prompt_eval_count") or 0)
            usage_out["output_tokens"] = usage_out.get("output_tokens", 0) + int(data.get("eval_count") or 0)
        return data.get("message", {}).get("content", "")


async def _chat_openai_compat(
    msgs: list[dict], model: str, base_url: str, usage_out: dict | None
) -> str:
    """llama.cpp server / vLLM 공용 — OpenAI 호환 /v1/chat/completions."""
    payload: dict[str, Any] = {"messages": msgs, "stream": False}
    if model:
        payload["model"] = model
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(f"{base_url}/v1/chat/completions", json=payload)
        resp.raise_for_status()
        data = resp.json()
        if usage_out is not None:
            usage = data.get("usage") or {}
            usage_out["input_tokens"] = usage_out.get("input_tokens", 0) + int(usage.get("prompt_tokens") or 0)
            usage_out["output_tokens"] = usage_out.get("output_tokens", 0) + int(usage.get("completion_tokens") or 0)
        choices = data.get("choices") or []
        if choices:
            return (choices[0].get("message") or {}).get("content", "") or ""
        return ""


async def chat(
    messages: list[dict[str, Any]],
    system: str,
    provider: str | None = None,
    model: str | None = None,
    base_url: str | None = None,
    usage_out: dict | None = None,
) -> str:
    """로컬 LLM 채팅 호출 — provider 미지정 시 config 기본(local_llm_provider).

    실패 시 RuntimeError (기존 call_ollama 와 동일 계약).
    """
    _provider = (provider or settings.local_llm_provider or "ollama").lower()
    if _provider not in PROVIDERS:
        _provider = "ollama"
    base_key, model_key = _PROVIDER_KEYS[_provider]
    _model = model or getattr(settings, model_key, "") or ""
    _base = (base_url or getattr(settings, base_key, "") or "").rstrip("/")

    msgs = _norm_messages(messages, system)
    try:
        if _provider == "ollama":
            return await _chat_ollama(msgs, _model, _base, usage_out)
        return await _chat_openai_compat(msgs, _model, _base, usage_out)
    except Exception as exc:  # noqa: BLE001
        logger.error("[llm_providers] %s 호출 실패(%s %s): %s", _provider, _base, _model, exc)
        raise RuntimeError(
            f"[AI 서비스 일시 장애] 로컬 LLM({_provider}:{_model or 'default'}) 응답 불가. "
            f"{_provider} 서버 실행 및 모델 설치를 확인하세요."
        ) from exc


async def check_provider(provider: str, base_url: str) -> dict:
    """provider 도달성 점검 — 상태/모델 목록 best-effort."""
    base = base_url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            if provider == "ollama":
                resp = await client.get(f"{base}/api/tags")
                resp.raise_for_status()
                models = [m.get("name") for m in resp.json().get("models", [])]
            else:
                resp = await client.get(f"{base}/v1/models")
                resp.raise_for_status()
                models = [m.get("id") for m in resp.json().get("data", [])]
        return {"provider": provider, "reachable": True, "models": models}
    except Exception as exc:  # noqa: BLE001
        return {"provider": provider, "reachable": False, "error": str(exc), "models": []}
