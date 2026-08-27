"""LLM Metering (R19-3) — 호출 단위 토큰 사용량 원장(tbl_llm_usage).

record(): 모든 LLM 호출 지점에서 best-effort 기록 (실패해도 본 호출에 영향 없음).
aggregate(): model/provider/user/day 단위 합계 조회.
"""
import logging

from app.db import execute_write, fetch_all, _IS_SQLITE, _PH

logger = logging.getLogger("uvicorn.error")

TASKS = ("classify", "tools", "synthesize", "domain", "chat")
GROUP_BYS = ("model", "provider", "user", "day", "task")


async def record(
    provider: str,
    model: str,
    task: str,
    usage: dict | None,
    latency_ms: int = 0,
    user_id: str | None = None,
    agent_key: str | None = None,
) -> None:
    """LLM 호출 1건 기록 — usage={'input_tokens','output_tokens'} (없으면 0)."""
    u = usage or {}
    try:
        await execute_write(
            f"INSERT INTO tbl_llm_usage "
            f"(user_id, agent_key, provider, model, task, tokens_in, tokens_out, latency_ms) "
            f"VALUES ({_PH},{_PH},{_PH},{_PH},{_PH},{_PH},{_PH},{_PH})",
            (
                user_id,
                agent_key,
                provider,
                model or "",
                task if task in TASKS else "chat",
                int(u.get("input_tokens") or 0),
                int(u.get("output_tokens") or 0),
                int(latency_ms),
            ),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[llm_metering] record 실패 (무시): %s", exc)


async def aggregate(group_by: str = "model", days: int = 30) -> list[dict]:
    """사용량 합계 — group_by: model|provider|user|day|task."""
    if group_by not in GROUP_BYS:
        group_by = "model"
    col = {
        "model": "model",
        "provider": "provider",
        "user": "user_id",
        "task": "task",
        "day": "date(created_at)" if _IS_SQLITE else "created_at::date",
    }[group_by]
    days = max(1, min(int(days), 365))
    since = (
        f"datetime('now', '-{days} days')" if _IS_SQLITE
        else f"NOW() - INTERVAL '{days} days'"
    )
    rows = await fetch_all(
        f"SELECT {col} AS grp, COUNT(*) AS calls, "
        f"SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out, "
        f"AVG(latency_ms) AS avg_latency_ms "
        f"FROM tbl_llm_usage WHERE created_at >= {since} "
        f"GROUP BY {col} ORDER BY tokens_in + tokens_out DESC"
    )
    for r in rows:
        r["grp"] = str(r.get("grp") or "")
        r["avg_latency_ms"] = round(float(r.get("avg_latency_ms") or 0), 1)
    return rows
