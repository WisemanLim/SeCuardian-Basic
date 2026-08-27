"""BaseAgent — 모든 Domain Agent의 추상 기반 클래스 (F2).

참조: SmartHaccp-MultiAgent app/agents/base_agent.py
패턴: tool_use 루프 → Claude API → Ollama fallback (E6)
"""
import json
import logging
from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator
from typing import Any

import anthropic

from app.core.config import settings
from app.services import llm_metering, llm_providers
from app.services.token_compress import compress_history

logger = logging.getLogger("uvicorn.error")


class BaseAgent(ABC):
    """Domain Agent 추상 기반. get_tools(), get_tool_executors() 를 구현하세요."""

    agent_key: str = "base"  # [CUSTOMIZE] 고유 식별자

    @abstractmethod
    def get_tools(self) -> list[dict[str, Any]]:
        """Anthropic tool_use 형식의 도구 목록 반환."""

    @abstractmethod
    def get_tool_executors(self) -> dict[str, Any]:
        """tool_name → async callable(tool_input) 매핑 반환."""

    def get_system_prompt(self) -> str:  # [CUSTOMIZE]
        return "You are a helpful domain specialist."

    async def build_domain_context(self, conn: Any = None) -> str:
        """도메인 DB 요약을 반환해 시스템 프롬프트에 주입. [CUSTOMIZE]"""
        return ""

    async def _execute(
        self, user_message: str, history: list[dict]
    ) -> AsyncGenerator[dict, None]:
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        domain_ctx = await self.build_domain_context()
        system = self.get_system_prompt()
        if domain_ctx:
            system += f"\n\n[현재 상태]\n{domain_ctx}"

        import time as _time

        # R19-4: 히스토리 토큰 예산 초과 시 압축
        history_c, _ = compress_history(list(history), settings.llm_context_budget)
        messages = history_c + [{"role": "user", "content": user_message}]
        tools = self.get_tools()
        executors = self.get_tool_executors()
        _usage: dict = {}
        _started = _time.monotonic()

        while True:
            try:
                resp = client.messages.create(
                    model=settings.domain_agent_model,
                    max_tokens=4096,
                    system=system,
                    tools=tools,
                    messages=messages,
                )
                if getattr(resp, "usage", None):
                    _usage["input_tokens"] = _usage.get("input_tokens", 0) + (resp.usage.input_tokens or 0)
                    _usage["output_tokens"] = _usage.get("output_tokens", 0) + (resp.usage.output_tokens or 0)
            except anthropic.APIError as exc:
                logger.warning("[%s] Claude API 오류, 로컬 LLM fallback: %s", self.agent_key, exc)
                # R19-1/3: 기본 로컬 provider 로 폴백 + 미터링
                provider, model, base_url = llm_providers.resolve_local()
                fb_usage: dict = {}
                fb_started = _time.monotonic()
                text = await llm_providers.chat(
                    messages, system, provider=provider, model=model,
                    base_url=base_url, usage_out=fb_usage,
                )
                await llm_metering.record(
                    provider=provider, model=model, task="domain", usage=fb_usage,
                    latency_ms=int((_time.monotonic() - fb_started) * 1000),
                    agent_key=self.agent_key,
                )
                yield {"type": "delta", "text": text}
                return

            if resp.stop_reason == "end_turn":
                await llm_metering.record(
                    provider="anthropic", model=settings.domain_agent_model, task="domain",
                    usage=_usage, latency_ms=int((_time.monotonic() - _started) * 1000),
                    agent_key=self.agent_key,
                )
                for block in resp.content:
                    if hasattr(block, "text"):
                        yield {"type": "delta", "text": block.text}
                return

            if resp.stop_reason == "tool_use":
                tool_calls = [b for b in resp.content if b.type == "tool_use"]
                messages.append({"role": "assistant", "content": resp.content})

                tool_results = []
                for tc in tool_calls:
                    yield {"type": "tool_call", "name": tc.name, "input": tc.input}
                    executor = executors.get(tc.name)
                    if executor:
                        try:
                            result = await executor(tc.input)
                        except Exception as exc:  # noqa: BLE001
                            result = f"오류: {exc}"
                    else:
                        result = f"알 수 없는 도구: {tc.name}"

                    yield {"type": "tool_result", "name": tc.name, "result": result}
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tc.id,
                        "content": json.dumps(result, ensure_ascii=False)
                        if not isinstance(result, str)
                        else result,
                    })

                messages.append({"role": "user", "content": tool_results})
            else:
                break

    async def run(self, user_message: str, history: list[dict]) -> str:
        text_parts: list[str] = []
        async for event in self._execute(user_message, history):
            if event["type"] == "delta":
                text_parts.append(event["text"])
        return "".join(text_parts)

    async def stream(
        self, user_message: str, history: list[dict]
    ) -> AsyncGenerator[str, None]:
        import json as _json

        try:
            async for event in self._execute(user_message, history):
                etype = event["type"]
                if etype == "delta":
                    yield f"event: delta\ndata: {_json.dumps({'text': event['text']})}\n\n"
                elif etype == "tool_call":
                    yield f"event: tool_call\ndata: {_json.dumps({'name': event['name'], 'input': event['input']})}\n\n"
                elif etype == "tool_result":
                    yield f"event: tool_result\ndata: {_json.dumps({'name': event['name']})}\n\n"
        except Exception as exc:
            yield f"event: error\ndata: {_json.dumps(str(exc))}\n\n"
