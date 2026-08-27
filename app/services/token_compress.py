"""Token 압축 (R19-4) — 대화 히스토리 토큰 예산 관리.

전략: 추정 토큰(문자수 기반)이 예산(llm_context_budget, 기본 8000)을 초과하면
① 최근 KEEP_RECENT 개 메시지는 원문 보존
② 오래된 메시지는 head/tail 축약(중간 '…[중략]…' 마커)
③ 그래도 초과하면 가장 오래된 메시지부터 제거
LLM 재요약은 사용하지 않는다(추가 호출 비용·지연 없음, 결정적 동작).
"""
import logging
from typing import Any

logger = logging.getLogger("uvicorn.error")

KEEP_RECENT = 6      # 원문 보존할 최근 메시지 수
HEAD_CHARS = 400     # 축약 시 앞부분 보존 문자수
TAIL_CHARS = 200     # 축약 시 뒷부분 보존 문자수
_CHARS_PER_TOKEN = 3  # 한국어/영문 혼합 보수적 추정 (chars/token)


def _content_str(content: Any) -> str:
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


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // _CHARS_PER_TOKEN)


def _messages_tokens(messages: list[dict]) -> int:
    return sum(estimate_tokens(_content_str(m.get("content", ""))) for m in messages)


def _truncate(text: str) -> str:
    if len(text) <= HEAD_CHARS + TAIL_CHARS:
        return text
    return f"{text[:HEAD_CHARS]}\n…[중략]…\n{text[-TAIL_CHARS:]}"


def compress_history(
    history: list[dict], budget: int
) -> tuple[list[dict], bool]:
    """(압축된 history, 압축 발생 여부). budget <= 0 이면 무압축."""
    if budget <= 0 or not history:
        return history, False
    if _messages_tokens(history) <= budget:
        return history, False

    compressed = False
    result: list[dict] = []
    n = len(history)
    for i, m in enumerate(history):
        if i >= n - KEEP_RECENT:
            result.append(m)
            continue
        text = _content_str(m.get("content", ""))
        short = _truncate(text)
        if short != text:
            compressed = True
            result.append({"role": m.get("role", "user"), "content": short})
        else:
            result.append(m)

    # 여전히 초과 — 가장 오래된 메시지부터 제거 (최근 KEEP_RECENT 는 보존)
    while _messages_tokens(result) > budget and len(result) > KEEP_RECENT:
        result.pop(0)
        compressed = True

    if compressed:
        logger.info(
            "[token_compress] history %d msgs → %d msgs (~%d tokens, budget %d)",
            n, len(result), _messages_tokens(result), budget,
        )
    return result, compressed
