"""Static keyword ruleset matcher — bypasses LLM for predefined commands."""
import json
import logging
from pathlib import Path

logger = logging.getLogger("uvicorn.error")

_RULES_PATH = Path(__file__).parent / "keyword_rules.json"
_rules: list[dict] | None = None


def _load_rules() -> list[dict]:
    global _rules
    if _rules is None:
        try:
            data = json.loads(_RULES_PATH.read_text(encoding="utf-8"))
            _rules = data.get("rules", [])
            logger.info("[keyword_matcher] %d rules loaded", len(_rules))
        except Exception as exc:
            logger.warning("[keyword_matcher] ruleset load failed: %s", exc)
            _rules = []
    return _rules


def match_rule(user_message: str) -> dict | None:
    """Static keyword match only. Case-insensitive substring."""
    normalized = user_message.lower().strip()
    for rule in _load_rules():
        if rule.get("action", {}).get("type") == "disabled_check":
            continue  # disabled_check is async-only
        for kw in rule.get("keywords", []):
            if kw.lower() in normalized:
                logger.warning("[keyword_matcher] matched rule=%s keyword=%s", rule["id"], kw)
                return rule
    return None


async def match_rule_async(user_message: str) -> dict | None:
    """Static match first, then dynamic disabled-agent check."""
    rule = match_rule(user_message)
    if rule:
        return rule

    # Dynamic: check if message mentions a disabled addon agent
    try:
        from app.db import fetch_all
        disabled = await fetch_all(
            "SELECT agent_key, agent_name FROM tbl_addon_agents WHERE is_active = 0"
        )
        if not disabled:
            return None
        normalized = user_message.lower()
        for addon in disabled:
            name = (addon.get("agent_name") or "").lower()
            key = (addon.get("agent_key") or "").lower()
            if (name and name in normalized) or (key and key in normalized):
                for r in _load_rules():
                    if r.get("action", {}).get("type") == "disabled_check":
                        logger.warning("[keyword_matcher] disabled agent match: %s", addon.get("agent_key"))
                        return r
    except Exception as exc:
        logger.warning("[keyword_matcher] disabled check failed: %s", exc)

    return None


def reload_rules() -> int:
    """Force reload from disk. Returns rule count."""
    global _rules
    _rules = None
    return len(_load_rules())


def format_response(rule: dict, api_result: str) -> str:
    """Format raw API result string per rule's format spec."""
    fmt = rule.get("format", {})
    fmt_type = fmt.get("type")

    if fmt_type == "disabled_message":
        return fmt.get("message_ko", "현재는 제공되지 않는 기능입니다.")

    if fmt_type == "static_text":
        return fmt.get("text_ko", "")

    try:
        parts = api_result.split("\n", 1)
        status_code = 0
        if parts[0].startswith("HTTP "):
            try:
                status_code = int(parts[0].split()[1])
            except (IndexError, ValueError):
                pass
        body = parts[1].strip() if len(parts) > 1 else api_result
        data = json.loads(body)
        if status_code >= 400:
            from app.agents.orchestrator import _format_api_error  # lazy — 순환 import 회피
            return _format_api_error(status_code, data, body)
    except Exception:
        return api_result

    if fmt_type == "agent_list":
        return _format_agent_list(data, fmt)

    return api_result


async def format_response_async(rule: dict, api_result: str) -> str:
    """format_response + agent_list 룰이면 ADDON 에이전트(tbl_addon_agents) 섹션 추가."""
    text = format_response(rule, api_result)
    if rule.get("id") != "agent_list":
        return text
    try:
        from app.db import fetch_all
        addons = await fetch_all(
            "SELECT agent_name, agent_key, api_prefix, is_active, has_front "
            "FROM tbl_addon_agents WHERE is_builtin = 0 ORDER BY uploaded_at DESC"
        )
    except Exception as exc:
        logger.warning("[keyword_matcher] addon list fetch failed: %s", exc)
        return text
    if not addons:
        return text
    lines = [text, "", "**ADDON 에이전트**"]
    for a in addons:
        enabled = "✅" if a.get("is_active") else "❌"
        screen = "" if a.get("has_front") else " — 화면 없음, AI 어시스턴트 질의응답"
        lines.append(f"- {enabled} {a.get('agent_name', '')} (`{a.get('api_prefix', '')}`){screen}")
    return "\n".join(lines)


def _format_agent_list(data: dict | list, fmt: dict) -> str:
    agents = data.get("agents", []) if isinstance(data, dict) else data
    if not agents:
        return "활성화된 에이전트가 없습니다. / No agents available."

    header = fmt.get("header_ko", "에이전트 목록:")

    groups: dict[str, list] = {}
    for agent in sorted(agents, key=lambda a: (a.get("sort_order") or 0)):
        group = agent.get("nav_group") or "기타"
        groups.setdefault(group, []).append(agent)

    lines = [header]
    for group, items in groups.items():
        lines.append(f"\n**{group}**")
        for a in items:
            name = a.get("agent_name", "")
            enabled = "✅" if a.get("is_enabled") else "❌"
            required = " (필수)" if a.get("is_required") else ""
            lines.append(f"- {enabled} {name}{required}")

    return "\n".join(lines)
