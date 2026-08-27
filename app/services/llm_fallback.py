"""Ollama HTTP fallback — Claude API 장애 시 로컬 LLM 전환 (F3).

참조: SmartHaccp-MultiAgent app/services/llm_fallback.py
호출 우선순위: Claude API → 로컬 LLM (기본 Ollama /api/chat)
R19-1: 실제 호출은 llm_providers 로 위임 — call_ollama 시그니처는 하위호환 유지.
tool_use 미지원 — 순수 텍스트 응답만 반환.
"""
import logging
from typing import Any

from app.services import llm_providers

logger = logging.getLogger("uvicorn.error")


async def call_ollama(
    messages: list[dict[str, Any]],
    system: str,
    model: str | None = None,
    base_url: str | None = None,
    usage_out: dict | None = None,
) -> str:
    """Ollama /api/chat 호출 (하위호환 래퍼 — llm_providers.chat 위임).

    usage_out 전달 시 토큰 사용량(prompt_eval_count/eval_count)을 누적 기록한다.
    """
    return await llm_providers.chat(
        messages,
        system,
        provider="ollama",
        model=model,
        base_url=base_url,
        usage_out=usage_out,
    )
