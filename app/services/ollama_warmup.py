"""Ollama 예열(warmup) — 콜드스타트 첫 토큰 지연 방지.

Ollama 는 (재)구동 후 첫 추론 요청에서 모델을 메모리에 로드하므로 첫 응답이 크게 지연된다
(예: 3.7s → 8.3s). 백그라운드에서 "hi" 를 선요청해 모델을 미리 상주시키고(keep_alive),
주기적으로 재예열해 'ollama 만 재구동' 한 경우에도 실제 AI 어시스턴트 응답 지연을 방지한다.

best-effort: ollama 미기동/오프라인 시 조용히 실패하고 다음 주기에 재시도한다.
"""
import asyncio
import logging

import httpx

logger = logging.getLogger("uvicorn.error")


async def _resolve_target() -> tuple[str, str]:
    """현재 유효한 Ollama base_url + model 결정 (DB 설정 우선, config 폴백)."""
    from app.core.config import settings
    try:
        from app.agents.orchestrator import _db_llm_settings
        db = await _db_llm_settings()
        base = db.get("ollama_base_url") or settings.ollama_base_url
        model = db.get("ollama_model") or settings.ollama_model
    except Exception:
        base, model = settings.ollama_base_url, settings.ollama_model
    return base.rstrip("/"), model


async def warmup_once(base_url: str | None = None, model: str | None = None) -> bool:
    """모델 상주 예열 1회. 성공 시 True, 실패(미기동/오프라인) 시 False (예외 없음)."""
    if base_url is None or model is None:
        base_url, model = await _resolve_target()
    payload = {"model": model, "prompt": "hi", "stream": False, "keep_alive": -1}
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(f"{base_url}/api/generate", json=payload)
            resp.raise_for_status()
        logger.info("[ollama-warmup] 예열 완료 (%s / %s)", base_url, model)
        return True
    except Exception as exc:  # noqa: BLE001
        logger.debug("[ollama-warmup] 예열 스킵 (%s / %s): %s", base_url, model, exc)
        return False


async def warmup_loop() -> None:
    """앱 기동 시 즉시 1회 + 주기 재예열. cancel 시 종료."""
    from app.core.config import settings
    interval = settings.ollama_warmup_interval
    try:
        while True:
            await warmup_once()
            if interval <= 0:
                return  # 1회만
            await asyncio.sleep(interval)
    except asyncio.CancelledError:  # shutdown
        raise
    except Exception as exc:  # noqa: BLE001
        logger.debug("[ollama-warmup] 루프 종료: %s", exc)
