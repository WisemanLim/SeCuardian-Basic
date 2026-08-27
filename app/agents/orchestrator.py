"""Orchestrator Agent — 의도 분류 → 병렬 라우팅 → 결과 합성 (F1).

패턴: Classify(1~3 intents) → asyncio.gather() → Synthesize
model 파라미터: "ollama" → Ollama 직접 사용, None/Claude모델 → Anthropic 사용 후 Ollama fallback
"""
import asyncio
import json
import logging
import re
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any

import anthropic
import httpx

from app.core.config import settings
from app.rules.keyword_matcher import format_response, format_response_async, match_rule_async
from app.services import llm_metering, llm_providers, llm_router
from app.services.token_compress import compress_history

logger = logging.getLogger("uvicorn.error")

# [CUSTOMIZE] 지원할 intent 카테고리 목록
_VALID_INTENTS: list[str] = [
    "general",   # 일반 질문 (Orchestrator 직접 응답)
]

# [CUSTOMIZE] intent → Agent 클래스 매핑
_AGENT_MAP: dict[str, Any] = {}

# [CUSTOMIZE] SSE 이벤트에 표시될 Agent 이름
_AGENT_LABELS: dict[str, str] = {
    "general": "일반 응답",
}

_TOOL_CALL_API: dict = {
    "name": "call_api",
    "description": (
        "Call a backend REST API to actually perform CRUD operations on addon agents. "
        "Use this tool whenever the user requests an action (create/read/update/delete data). "
        "NEVER fabricate data or pretend to perform operations — always call this tool first."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "method": {"type": "string", "enum": ["GET", "POST", "PATCH", "DELETE"]},
            "path": {"type": "string", "description": "Full API path, e.g. /api/addon/usermanager/users"},
            "body": {"type": "object", "description": "JSON request body (POST/PATCH)"},
            "params": {"type": "object", "description": "Query parameters (GET)"},
        },
        "required": ["method", "path"],
    },
}


async def _exec_api_call(
    method: str, path: str, body: dict | None, params: dict | None, token: str | None
) -> str:
    from app.main import app as _app  # lazy — no circular import at call time
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    try:
        transport = httpx.ASGITransport(app=_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as c:
            fn = getattr(c, method.lower())
            kwargs: dict = {"headers": headers}
            if body is not None and method.upper() not in ("GET", "HEAD"):
                kwargs["json"] = body
            if params:
                kwargs["params"] = params
            resp = await fn(path, **kwargs)
            # Include status code so Claude knows if the call succeeded or failed
            return f"HTTP {resp.status_code}\n{resp.text}"
    except Exception as exc:
        return f"HTTP ERROR\n{json.dumps({'error': str(exc)})}"


def _parse_router_prefix(router_path: str) -> str:
    """AST-parse the router .py file and extract APIRouter(prefix=...) value."""
    import ast
    try:
        src = Path(router_path).read_text(encoding="utf-8")
        tree = ast.parse(src)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            fn = node.func
            is_router_call = (
                (isinstance(fn, ast.Attribute) and fn.attr == "APIRouter")
                or (isinstance(fn, ast.Name) and fn.id == "APIRouter")
            )
            if not is_router_call:
                continue
            for kw in node.keywords:
                if kw.arg == "prefix" and isinstance(kw.value, ast.Constant):
                    return str(kw.value.value)
    except Exception:
        pass
    return ""


def _parse_create_model_fields(router_path: str) -> dict[str, list[str]]:
    """Extract XxxCreate/XxxUpdate(BaseModel) field names from router source."""
    import re
    result: dict[str, list[str]] = {}
    try:
        src = Path(router_path).read_text(encoding="utf-8")
        current: str | None = None
        for line in src.splitlines():
            m = re.match(r"^class (\w+)\(BaseModel\)", line.strip())
            if m:
                current = m.group(1)
                result[current] = []
            elif current:
                field_m = re.match(r"^\s{4}(\w+)\s*:", line)
                if field_m:
                    result[current].append(field_m.group(1))
                elif line.strip() and not line.startswith((" ", "\t")):
                    current = None
    except Exception:
        pass
    return result


_SKIP_KEYS = {"is_deleted", "created_at", "updated_at", "password"}

# 리스트 항목의 대표 필드 후보 — 첫 일치 필드를 굵게 표시 (공통 파싱룰)
_TITLE_KEYS = ("agent_name", "name", "title", "label", "username", "host", "hostname", "scan_id", "agent_key", "id")


def _humanize_value(v: Any) -> str:
    if v is True:
        return "예"
    if v is False:
        return "아니오"
    if v is None:
        return "없음"
    return str(v)


def _format_api_error(status_code: int, data: Any, body: str = "") -> str:
    """HTTP 오류 응답 → 사용자 친화적 한국어 메시지 (공통 파싱룰)."""
    if status_code == 422:
        fields: list[str] = []
        detail = data.get("detail") if isinstance(data, dict) else None
        if isinstance(detail, list):
            for e in detail:
                loc = [str(x) for x in e.get("loc", []) if x not in ("body", "query", "path")]
                fields.append(".".join(loc) if loc else "요청 본문(body)")
        target = ", ".join(dict.fromkeys(fields)) or "필수 입력값"
        return (
            f"❌ 요청에 필요한 값이 누락되었거나 형식이 올바르지 않습니다 (대상: {target}). "
            "필요한 정보를 포함해 다시 요청해 주세요."
        )
    if status_code in (401, 403):
        return "❌ 권한이 없어 처리하지 못했습니다. 로그인 상태 또는 접근 권한을 확인해 주세요."
    if status_code == 404:
        return "❌ 요청한 대상을 찾을 수 없습니다. 이름이나 경로를 다시 확인해 주세요."
    if status_code == 409:
        return "❌ 이미 존재하거나 충돌하는 항목이 있어 처리하지 못했습니다."
    if status_code >= 500:
        return "❌ 서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
    detail = ""
    if isinstance(data, dict):
        detail = data.get("detail") or data.get("message") or ""
    if not isinstance(detail, str):
        detail = json.dumps(detail, ensure_ascii=False)[:200]
    return f"❌ 오류가 발생했습니다 (HTTP {status_code}): {detail or body[:200]}"


def _format_list_md(items: list, total: int) -> str:
    """list API 결과 → 마크다운 불릿 리스트 (대표 필드 굵게, 나머지 key: value, 공통 파싱룰)."""
    lines = [f"✅ 조회 결과 (총 {total}건):", ""]
    for item in items[:10]:
        if not isinstance(item, dict):
            lines.append(f"- {_humanize_value(item)}")
            continue
        title_key = next((k for k in _TITLE_KEYS if item.get(k) not in (None, "")), None)
        rest = " · ".join(
            f"{k}: {_humanize_value(v)}"
            for k, v in item.items()
            if k != title_key and k not in _SKIP_KEYS and not k.startswith("_")
            and v not in (None, "")
        )
        if title_key:
            lines.append(f"- **{item[title_key]}**" + (f" — {rest}" if rest else ""))
        else:
            lines.append(f"- {rest}" if rest else "- (빈 항목)")
    if len(items) > 10:
        lines.append(f"- … 외 {len(items) - 10}건")
    return "\n".join(lines)


def _format_dict_md(data: dict, indent: int = 0) -> list[str]:
    """dict → 마크다운 key-value 리스트 (중첩 dict 재귀, 공통 파싱룰)."""
    lines: list[str] = []
    pad = "  " * indent
    for k, v in data.items():
        if k in _SKIP_KEYS or k.startswith("_"):
            continue
        if isinstance(v, dict):
            lines.append(f"{pad}- **{k}**:")
            lines.extend(_format_dict_md(v, indent + 1))
        elif isinstance(v, list):
            lines.append(f"{pad}- **{k}**: {len(v)}건")
        else:
            lines.append(f"{pad}- **{k}**: {_humanize_value(v)}")
    return lines


def _format_api_result(method: str, path: str, raw: str) -> str:
    """HTTP API 결과 → 사용자 친화적 한국어 텍스트."""
    parts = raw.split("\n", 1)
    status_line = parts[0]  # e.g. "HTTP 201"
    body = parts[1].strip() if len(parts) > 1 else ""
    try:
        status_code = int(status_line.split()[1])
    except (IndexError, ValueError):
        status_code = 0
    try:
        data = json.loads(body) if body else {}
    except json.JSONDecodeError:
        data = {}

    method = method.upper()
    if 200 <= status_code < 300:
        if method == "DELETE":
            return "✅ 삭제가 완료되었습니다."
        if method == "GET":
            # find first list value: supports "items", "addons", "data", "results", etc.
            items = None
            total = None
            if isinstance(data, list):
                items = data
            elif isinstance(data, dict):
                for v in data.values():
                    if isinstance(v, list):
                        items = v
                        break
                total = data.get("total")
            if items is not None:
                if total is None:
                    total = len(items)
                if not items:
                    return f"✅ 조회 결과: {total}건"
                # 문맥 인지: 에이전트 목록은 keyword rule(에이전트 목록)과 동일 포맷으로 통일
                if "/agent-config" in path:
                    from app.rules.keyword_matcher import _format_agent_list
                    return _format_agent_list(
                        data if isinstance(data, dict) else items,
                        {"header_ko": "현재 활성화된 에이전트 목록입니다:"},
                    )
                return _format_list_md(items, total)
            if isinstance(data, dict) and data:
                lines = _format_dict_md(data)
                if lines:
                    return "✅ 조회 결과:\n" + "\n".join(lines)
            return f"✅ 조회 완료:\n{body[:500]}"
        # POST / PATCH
        verb = "등록" if method == "POST" else "수정"
        if isinstance(data, dict):
            fields = [f"{k}: {v}" for k, v in data.items() if k not in ("id", "created_at", "updated_at", "is_deleted", "password") and v not in (None, "", False)]
            detail = "\n".join(f"  • {f}" for f in fields[:6])
            return f"✅ {verb}이 완료되었습니다.\n{detail}" if detail else f"✅ {verb}이 완료되었습니다."
        return f"✅ {verb}이 완료되었습니다."
    else:
        return _format_api_error(status_code, data, body)


def _strip_api_tags(text: str) -> str:
    """사용자 노출용 텍스트에서 <api_call> 태그·JSON 블록 제거 (Ollama 원문 누출 방지)."""
    import re as _re
    # 완결 태그: <api_call>...</api_call>
    text = _re.sub(r"<api_call>.*?</api_call>", "", text, flags=_re.DOTALL)
    # 미완결 태그: <api_call> 이후 끝까지 (닫는 태그 없이 잘린 경우)
    text = _re.sub(r"<api_call>.*", "", text, flags=_re.DOTALL)
    # 태그 감싸던 빈 코드블록·말미에 남은 여는 코드펜스 잔여물 제거
    text = _re.sub(r"```(?:\w+)?\s*```", "", text)
    text = _re.sub(r"```\w*\s*$", "", text)
    return _re.sub(r"\n{3,}", "\n\n", text).strip()


def _looks_like_prompt_echo(text: str) -> bool:
    """모델이 시스템 프롬프트/오류 피드백을 그대로 되풀이한 응답인지 감지 (내부 규칙 노출 방지)."""
    markers = ("CRITICAL RULE", "api_call", "API 오류:", "오류 내용을 사용자에게", "Do NOT hallucinate")
    return any(m in text for m in markers)


def _safe_ollama_text(text: str, last_error: str) -> str:
    """Ollama 원문을 사용자 노출용으로 정리. 오류 이력이 있거나 프롬프트 echo 면 친화적 메시지로 대체."""
    if last_error:
        return last_error
    cleaned = _strip_api_tags(text)
    if not cleaned or _looks_like_prompt_echo(cleaned):
        return "요청을 처리하지 못했습니다. 다시 시도해 주세요."
    return cleaned


# ── 공통 기능안내 룰 — 에이전트별 정적 텍스트 대신 app.routes 동적 생성 ────────
_CAPABILITY_KEYWORDS = (
    "제공되는 기능", "제공하는 기능", "기능을 알려", "기능 알려", "기능이 뭐",
    "무슨 기능", "어떤 기능", "무엇을 할 수", "뭘 할 수", "사용법",
    "capabilities", "what can you do", "available features",
)

def _is_capability_question(msg: str) -> bool:
    normalized = msg.lower()
    return any(k in normalized for k in _CAPABILITY_KEYWORDS)


def _openapi_paths() -> dict:
    """전체 API 경로 스키마 — app.routes 는 lazy include(_IncludedRouter)라 openapi 스키마 사용."""
    from app.main import app as _app  # lazy — no circular import at call time
    try:
        _app.openapi_schema = None  # addon 핫배포 반영 위해 캐시 무효화 후 재생성
        return (_app.openapi() or {}).get("paths", {})
    except Exception as exc:
        logger.warning("[orchestrator] openapi 스키마 생성 실패: %s", exc)
        return {}


def _probe_prefix(agent_key: str) -> str | None:
    """agent_key 로 실재하는 API prefix 를 추정 (내장 라우터 대응).

    후보 순서: /api/addon/{key} → /api/{key} → /api/{앞2토큰} → /api/{각 토큰}
    예: my-agent → /api/addon/my-agent 또는 /api/my-agent
    """
    toks = agent_key.split("-")
    candidates = [f"/api/addon/{agent_key}", f"/api/{agent_key}"]
    if len(toks) > 2:
        candidates.append("/api/" + "-".join(toks[:2]))
    candidates += [f"/api/{t}" for t in toks if len(t) > 2]

    route_paths = list(_openapi_paths())
    for cand in candidates:
        if any(p == cand or p.startswith(cand + "/") for p in route_paths):
            return cand
    return None


async def _resolve_capability_target(
    msg: str, agent_key: str | None = None
) -> tuple[str, str] | None:
    """기능안내 대상 에이전트 결정 → (agent_name, api_prefix).

    우선순위: agent_key 정확 일치 > 메시지 내 이름/키 언급.
    소스: tbl_addon_agents (업로드 addon, prefix 보유) + tbl_agent_config (내장, prefix 프로브).
    """
    from app.db import fetch_all
    try:
        addon_rows = await fetch_all(
            "SELECT agent_key, agent_name, api_prefix FROM tbl_addon_agents WHERE is_active = 1"
        )
    except Exception:
        addon_rows = []
    try:
        cfg_rows = await fetch_all(
            "SELECT agent_key, agent_name FROM tbl_agent_config WHERE is_enabled = 1"
        )
    except Exception:
        cfg_rows = []

    def _to_target(key: str, name: str, prefix: str | None) -> tuple[str, str] | None:
        prefix = prefix or _probe_prefix(key)
        return (name, prefix) if prefix else None

    if agent_key:
        for r in addon_rows:
            if r["agent_key"] == agent_key:
                t = _to_target(agent_key, r["agent_name"], r["api_prefix"])
                if t:
                    return t
        for r in cfg_rows:
            if r["agent_key"] == agent_key:
                t = _to_target(agent_key, r["agent_name"], None)
                if t:
                    return t
        # 테이블에 없어도 addon 페이지 컨텍스트면 라우트 프로브 시도
        prefix = _probe_prefix(agent_key)
        if prefix:
            return agent_key, prefix

    normalized = msg.lower()
    for r in addon_rows:
        key = (r["agent_key"] or "").lower()
        name = (r["agent_name"] or "").lower()
        if (key and key in normalized) or (name and name in normalized):
            t = _to_target(r["agent_key"], r["agent_name"], r["api_prefix"])
            if t:
                return t
    for r in cfg_rows:
        key = (r["agent_key"] or "").lower()
        name = (r["agent_name"] or "").lower()
        if (key and key in normalized) or (name and name in normalized):
            t = _to_target(r["agent_key"], r["agent_name"], None)
            if t:
                return t
    return None


def _agent_capabilities_md(agent_name: str, api_prefix: str) -> str:
    """openapi 스키마에서 prefix 하위 엔드포인트를 추출해 기능안내 마크다운 생성 (공통룰)."""
    paths = _openapi_paths()
    lines: list[str] = []
    for path in sorted(paths):
        if not (path == api_prefix or path.startswith(api_prefix.rstrip("/") + "/")):
            continue
        for method, op in paths[path].items():
            if method.upper() in ("HEAD", "OPTIONS"):
                continue
            doc = (op.get("description") or op.get("summary") or "").strip().splitlines()
            desc = doc[0].split("—")[0].strip() if doc else ""
            lines.append(f"- **{method.upper()}** `{path}`" + (f" — {desc}" if desc else ""))
    if not lines:
        return ""
    return (
        f"**{agent_name}** 에이전트가 제공하는 기능입니다.\n\n"
        "사용 가능한 API 호출들은 다음과 같습니다:\n\n" + "\n".join(lines)
    )


def _openapi_endpoint_lines(prefix: str, limit: int = 12) -> list[str]:
    """openapi 스키마에서 prefix 하위 실제 엔드포인트를 'METHOD path?query= — summary' 라인으로 추출.

    query 파라미터를 누락하면 LLM 이 REST 관례를 추측해 존재하지 않는 path
    (예: /interface/eth0/usage)를 만들어내므로, 실제 query 파라미터명을 노출한다.
    """
    lines: list[str] = []
    for path, methods in sorted(_openapi_paths().items()):
        if not (path == prefix or path.startswith(prefix + "/")):
            continue
        for method, spec in methods.items():
            if method.upper() not in ("GET", "POST", "PUT", "PATCH", "DELETE"):
                continue
            summary = (spec.get("summary") or spec.get("description") or "").strip().split("\n")[0]
            query_params = [p["name"] for p in spec.get("parameters", []) if p.get("in") == "query"]
            path_display = path + ("?" + "&".join(f"{q}=" for q in query_params) if query_params else "")
            lines.append(f"    {method.upper():6s} {path_display}" + (f" — {summary}" if summary else ""))
            if len(lines) >= limit:
                return lines
    return lines


async def _builtin_api_specs() -> str:
    """활성 내장 에이전트의 실제 엔드포인트 스펙.

    openapi 스키마에서 에이전트별 경로를 동적 생성해 LLM 의 경로 오라우팅을 방지한다.
    """
    try:
        from app.db import fetch_all
        rows = await fetch_all(
            "SELECT agent_key, agent_name FROM tbl_agent_config WHERE is_enabled = 1 ORDER BY sort_order"
        )
    except Exception as exc:
        logger.error("[orchestrator] _builtin_api_specs 오류: %s", exc)
        return ""
    lines: list[str] = []
    for r in rows:
        prefix = _probe_prefix(r["agent_key"])
        if not prefix or prefix.startswith("/api/addon/"):
            continue
        endpoints = _openapi_endpoint_lines(prefix)
        if not endpoints:
            continue
        lines.append(f"  [{r['agent_name']}]")
        lines.extend(endpoints)
    return "\n".join(lines)


async def _addon_api_specs() -> str:
    """Active addon agents + their REST endpoints (from AST-parsed router prefix)."""
    try:
        from app.db import fetch_all
        rows = await fetch_all(
            "SELECT agent_key, agent_name, api_prefix, router_path FROM tbl_addon_agents WHERE is_active = 1"
        )
        if not rows:
            return ""
        lines = ["Addon Agent APIs — use the call_api tool (or <api_call> tag for Ollama) to interact:"]
        for a in rows:
            api_prefix = a["api_prefix"]
            name = a["agent_name"]
            router_path = a.get("router_path") or ""
            sub_prefix = _parse_router_prefix(router_path) if router_path else ""
            base = api_prefix + sub_prefix  # e.g. /api/addon/usermanager/users
            logger.debug("[orchestrator] addon spec: %s → %s", name, base)
            # openapi 에 실재하는 경로가 있으면 그대로 노출 (CRUD 추측 템플릿은
            # /status 등 커스텀 엔드포인트를 누락시켜 오라우팅 유발)
            real_endpoints = _openapi_endpoint_lines(api_prefix)
            if real_endpoints:
                lines.append(f"  [{name}] base: {api_prefix}")
                lines.extend(real_endpoints)
                continue
            models = _parse_create_model_fields(router_path) if router_path else {}
            # pick the first XxxCreate model for POST body hint
            create_fields = next(
                (v for k, v in models.items() if k.endswith("Create")), []
            )
            update_fields = next(
                (v for k, v in models.items() if k.endswith("Update")), []
            )
            create_hint = (
                f" body={{{', '.join(f'\"{f}\":...' for f in create_fields)}}}"
                if create_fields else ""
            )
            update_hint = (
                f" body={{{', '.join(f'\"{f}\":...' for f in update_fields)}}}"
                if update_fields else ""
            )
            lines.append(f"  [{name}] base: {base}")
            lines.append(f"    GET    {base}                 — list/search")
            lines.append(f"    POST   {base}{create_hint}  — create")
            lines.append(f"    PATCH  {base}/{{id}}{update_hint}  — update")
            lines.append(f"    DELETE {base}/{{id}}            — delete")
        return "\n".join(lines)
    except Exception as exc:
        logger.error("[orchestrator] _addon_api_specs 오류: %s", exc)
        return ""


_CLASSIFY_SYSTEM = (
    "Analyze the user message and return the most applicable category as a JSON array.\n"
    "Return ONLY a JSON array, no other text. Example: [\"general\"]\n"
    "Rules:\n"
    "- Use 'general' for: data operations (add/create/register/edit/update/delete/search/list), "
    "agent management, system operations, questions about platform data.\n"
    "- Use 'chat' ONLY for: casual conversation, greetings, general knowledge questions "
    "that require NO data access or actions.\n"
    "When in doubt, use 'general'.\n"
    "Valid categories: " + ", ".join(_VALID_INTENTS)
)

_PLATFORM_BASE_SYSTEM = """\
당신은 SeCuardian-Basic Platform의 AI 어시스턴트입니다.

## 역할 및 책임
- 현재 플랫폼에서 활성화된 에이전트와 기능을 기반으로만 답변합니다.
- 플랫폼에 존재하지 않는 기능·외부 서비스·비활성 에이전트에 대한 정보를 제공하지 않습니다.
- 지원하지 않는 요청에는 "현재 플랫폼에서 지원하지 않는 기능입니다."라고 답변합니다.

## 데이터 정확성 원칙 (환각 방지)
- 사용자가 데이터 조회·생성·수정·삭제를 요청하면 반드시 call_api 도구를 호출하여 실제 API로 처리합니다.
- API 호출 없이 데이터를 지어내거나 가정하여 응답하지 않습니다.
- API 응답 결과를 그대로 사용자에게 전달하며, 임의로 수정하거나 보완하지 않습니다.
- 오류 응답(4xx, 5xx)이 반환되면 사용자에게 정확한 오류 내용을 알립니다.

## 응답 원칙
- 기본 응답 언어는 한국어이며, 사용자 언어에 따라 조정합니다.
- 확인되지 않은 정보·불확실한 사실은 절대 제공하지 않습니다.
- 간결하고 명확한 답변을 제공하며, 불필요한 설명을 반복하지 않습니다.

---

You are the AI assistant of the SeCuardian-Basic Platform.

## Role & Responsibilities
- Answer ONLY based on features and agents that are currently active on this platform.
- Do NOT provide information about non-existent features, external services, or disabled agents.
- For unsupported requests, respond: "This feature is not supported on the current platform."

## Data Accuracy Principles (Anti-Hallucination)
- When users request data operations (read/create/update/delete), you MUST call the call_api tool to invoke the actual API.
- Never fabricate or assume data without first making an actual API call.
- Relay API responses exactly as received; do not modify or supplement them.
- If the API returns an error (4xx/5xx), report the exact error to the user.

## Response Principles
- Default response language is Korean; adapt to the user's language.
- Never provide unverified or uncertain information.
- Be concise and clear; avoid unnecessary repetition.\
"""


# 플랫폼 자체 관리 시스템지침 (app/rules/platform_instructions.md) — mtime 캐시
_PLATFORM_RULES_PATH = Path("app/rules/platform_instructions.md")
_platform_rules_cache: tuple[float, str] = (0.0, "")


def _load_platform_instructions() -> str:
    """SeCuardian-Basic 자체 시스템지침 로드 — supervisor 맞춤지침과 별개 레이어 (파일로 관리).

    mtime 변경 시에만 재파싱, HTML 주석 블록은 프롬프트에서 제외.
    """
    global _platform_rules_cache
    try:
        mtime = _PLATFORM_RULES_PATH.stat().st_mtime
    except OSError:
        return ""
    if mtime != _platform_rules_cache[0]:
        text = _PLATFORM_RULES_PATH.read_text(encoding="utf-8")
        text = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL).strip()
        _platform_rules_cache = (mtime, text)
    return _platform_rules_cache[1]


async def _active_agents_block() -> str:
    """활성 에이전트 이름+설명 블록 — 플랫폼 용어(Orchestrator 등)를 일반 지식이 아닌
    플랫폼 정의로 답하게 하는 근거 (Claude·Ollama 프롬프트 공용)."""
    from app.db import fetch_all
    try:
        agent_rows = await fetch_all(
            "SELECT agent_key, agent_name, agent_names, descriptions, description "
            "FROM tbl_agent_config WHERE is_enabled = 1 ORDER BY sort_order"
        )
    except Exception:
        return ""
    if not agent_rows:
        return ""

    def _pick(raw: str | None, legacy: str | None) -> str:
        """R20-5: descriptions/agent_names JSON(ko→en→첫 언어) → 레거시 컬럼 폴백."""
        if raw and raw.strip():
            try:
                j = json.loads(raw)
                if isinstance(j, dict):
                    return j.get("ko") or j.get("en") or next((v for v in j.values() if v), "") or (legacy or "")
            except (ValueError, TypeError):
                pass
        return legacy or ""

    lines = []
    for r in agent_rows:
        name = _pick(r.get("agent_names"), r.get("agent_name")) or r["agent_key"]
        desc = _pick(r.get("descriptions"), r.get("description")).strip().replace("\n", " ")
        if len(desc) > 120:
            desc = desc[:120] + "…"
        lines.append(f"- {name} ({r['agent_key']})" + (f": {desc}" if desc else ""))
    return "Currently active agents:\n" + "\n".join(lines)


async def _build_system_prompt(user_id: str | None = None, agent_key: str | None = None) -> str:
    """플랫폼 제한 + 활성 에이전트 목록 + 시스템/사용자 맞춤지침 조합."""
    from app.db import fetch_one, _PH as _PH_
    parts = [_PLATFORM_BASE_SYSTEM]

    # SeCuardian-Basic 자체 시스템지침 — supervisor '시스템 맞춤지침'보다 먼저(높은 우선순위) 적용
    platform_rules = _load_platform_instructions()
    if platform_rules:
        parts.append(f"[플랫폼 지침 / Platform Instructions]\n{platform_rules}")

    # 전용 화면 없는 addon 페이지에서 진입한 Q&A — 해당 에이전트로 스코프
    if agent_key:
        try:
            focus = await fetch_one(
                f"SELECT agent_name, agent_type, api_prefix, meta_json "
                f"FROM tbl_addon_agents WHERE agent_key = {_PH_} AND is_active = 1",
                (agent_key,),
            )
            if focus:
                desc = ""
                try:
                    desc = json.loads(focus.get("meta_json") or "{}").get("description", "")
                except Exception:
                    pass
                parts.append(
                    "[Focused Agent Instructions]\n"
                    f"The user is currently on the '{focus['agent_name']}' ({agent_key}) addon agent page. "
                    f"agent_type: {focus.get('agent_type')}, API prefix: {focus.get('api_prefix')}."
                    + (f" Description: {desc}" if desc else "")
                    + "\nPrioritize answering questions about THIS agent, and use its APIs via the "
                    "call_api tool for any data operations the user requests."
                )
        except Exception:
            pass

    agents_block = await _active_agents_block()
    if agents_block:
        parts.append(agents_block)

    builtin_spec = await _builtin_api_specs()
    if builtin_spec:
        parts.append(
            "Built-in Agent APIs — use the call_api tool with these exact paths only:\n"
            + builtin_spec
        )

    addon_spec = await _addon_api_specs()
    if addon_spec:
        parts.append(addon_spec)
        parts.append(
            "IMPORTANT: When the user requests any action (add/create/edit/delete/list/search) "
            "on an addon agent, you MUST use the call_api tool to actually perform it. "
            "Never fabricate API responses or pretend an action was performed."
        )

    try:
        sys_row = await fetch_one(
            "SELECT value FROM tbl_settings WHERE key = 'system_custom_instructions'"
        )
        if sys_row and sys_row.get("value"):
            parts.append(f"[시스템 맞춤지침 / System Instructions]\n{sys_row['value']}")
    except Exception:
        pass

    try:
        usr_common_row = await fetch_one(
            "SELECT value FROM tbl_settings WHERE key = 'user_custom_instructions'"
        )
        if usr_common_row and usr_common_row.get("value"):
            parts.append(f"[사용자 공통 맞춤지침 / User Common Instructions]\n{usr_common_row['value']}")
    except Exception:
        pass

    if user_id:
        try:
            user_row = await fetch_one(
                f"SELECT custom_instructions FROM tbl_users WHERE user_id = {_PH_}",
                (user_id,),
            )
            if user_row and user_row.get("custom_instructions"):
                parts.append(f"[User Instructions]\n{user_row['custom_instructions']}")
        except Exception:
            pass

    return "\n\n".join(parts)


async def _disabled_agents() -> set[str]:
    """is_enabled=0 인 agent_key 집합 (DB 조회 실패 시 빈 세트 반환)."""
    try:
        from app.db import fetch_all
        rows = await fetch_all(
            "SELECT agent_key FROM tbl_agent_config WHERE is_enabled = 0"
        )
        return {r["agent_key"] for r in rows}
    except Exception:
        return set()


_SETTING_ENV_MAP = {
    "orchestrator_model": "ORCHESTRATOR_MODEL",
    "domain_agent_model": "DOMAIN_AGENT_MODEL",
    "ollama_base_url": "OLLAMA_BASE_URL",
    "ollama_model": "OLLAMA_MODEL",
    # R19-1: 로컬 LLM 다중 백엔드
    "local_llm_provider": "LOCAL_LLM_PROVIDER",
    "llamacpp_base_url": "LLAMACPP_BASE_URL",
    "llamacpp_model": "LLAMACPP_MODEL",
    "vllm_base_url": "VLLM_BASE_URL",
    "vllm_model": "VLLM_MODEL",
    # R19-4: 토큰 압축 예산
    "llm_context_budget": "LLM_CONTEXT_BUDGET",
    # tool-call 최대 루프 횟수
    "llm_tool_max_rounds": "LLM_TOOL_MAX_ROUNDS",
}


async def _db_llm_settings() -> dict[str, str]:
    """LLM 설정 — 우선순위: os.environ > .env.* 파일 > tbl_settings DB > 기본값.

    우선순위 상세:
    1. os.environ  : Docker Compose environment:/env_file: 로 주입된 값 (최우선)
    2. .env.* 파일 : pydantic-settings 가 로드한 값 (.env.local 등) — 기본값과 다를 때만 적용
    3. tbl_settings: Setup Wizard/UI 에서 저장한 DB 값
    4. 기본값       : config.py 하드코딩 기본

    pydantic-settings 는 .env 파일을 settings 객체에만 로드하고 os.environ 에는 주입하지
    않으므로, settings 객체 값이 기본값과 다를 때는 .env 에서 명시된 것으로 판단해 DB를 덮어쓴다.
    """
    import os
    from app.core.config import settings as _settings

    # pydantic config.py 기본값 (이와 다르면 .env 에서 명시 설정된 것)
    _pydantic_defaults = {
        "ollama_model": "mistral",
        "ollama_base_url": "http://localhost:11434",
        "orchestrator_model": "claude-sonnet-4-6",
        "domain_agent_model": "claude-haiku-4-5-20251001",
        # R19: 로컬 LLM 다중 백엔드 + 토큰 예산
        "local_llm_provider": "ollama",
        "llamacpp_base_url": "http://localhost:8180",
        "llamacpp_model": "",
        "vllm_base_url": "http://localhost:8100",
        "vllm_model": "",
        "llm_context_budget": "8000",
        "llm_tool_max_rounds": "6",
    }
    _settings_vals = {
        "ollama_model": _settings.ollama_model,
        "ollama_base_url": _settings.ollama_base_url,
        "orchestrator_model": _settings.orchestrator_model,
        "domain_agent_model": _settings.domain_agent_model,
        "local_llm_provider": _settings.local_llm_provider,
        "llamacpp_base_url": _settings.llamacpp_base_url,
        "llamacpp_model": _settings.llamacpp_model,
        "vllm_base_url": _settings.vllm_base_url,
        "vllm_model": _settings.vllm_model,
        "llm_context_budget": str(_settings.llm_context_budget),
        "llm_tool_max_rounds": str(_settings.llm_tool_max_rounds),
    }

    # 1단계: DB 값 로드
    try:
        from app.db import fetch_all
        rows = await fetch_all(
            "SELECT key, value FROM tbl_settings WHERE key IN "
            "('ollama_base_url','ollama_model','orchestrator_model','domain_agent_model',"
            "'local_llm_provider','llamacpp_base_url','llamacpp_model',"
            "'vllm_base_url','vllm_model','llm_context_budget','llm_tool_max_rounds')"
        )
        result = {r["key"]: r["value"] for r in rows if r.get("value")}
    except Exception:
        result = {}

    # 2단계: pydantic settings 값이 기본값과 다르면 .env.* 에서 명시된 것 → DB 덮어쓰기
    for key, val in _settings_vals.items():
        if val and val != _pydantic_defaults.get(key):
            result[key] = val

    # 3단계: os.environ 명시 시 최우선 (Docker Compose environment:/env_file: 주입)
    for db_key, env_key in _SETTING_ENV_MAP.items():
        val = os.environ.get(env_key)
        if val:
            result[db_key] = val

    return result


# ── F25: Orchestrator 고도화 ──────────────────────────────────────────────────

_HIGH_RISK_INTENTS: set[str] = {"delete", "deploy", "execute", "approve"}


async def _get_setting_bool(key: str, default: bool = False) -> bool:
    """tbl_settings bool 설정 조회 (true/1/yes → True)."""
    from app.db import fetch_one, _PH
    try:
        row = await fetch_one(f"SELECT value FROM tbl_settings WHERE key = {_PH}", (key,))
        if row and row.get("value"):
            return str(row["value"]).lower() in ("true", "1", "yes")
        return default
    except Exception:
        return default


async def _registry_find_by_verb(verb: str) -> list[dict]:
    """tbl_addon_agent_capabilities 에서 verb 일치 활성 addon 검색."""
    from app.db import fetch_all, _PH
    try:
        return await fetch_all(
            f"SELECT a.agent_key, a.agent_name, a.agent_type, a.api_prefix "
            f"FROM tbl_addon_agents a "
            f"JOIN tbl_addon_agent_capabilities c ON a.agent_key = c.agent_key "
            f"WHERE c.verb = {_PH} AND a.is_active = 1",
            (verb,),
        )
    except Exception:
        return []


async def _find_agent_by_type(agent_type: str) -> dict | None:
    """활성 addon 중 agent_type 일치 첫 번째 항목 반환."""
    from app.db import fetch_one, _PH
    try:
        return await fetch_one(
            f"SELECT agent_key, agent_name, api_prefix "
            f"FROM tbl_addon_agents WHERE agent_type = {_PH} AND is_active = 1",
            (agent_type,),
        )
    except Exception:
        return None


async def _call_reviewer_gate(response_text: str, token: str | None) -> dict:
    """Reviewer addon /review 엔드포인트 호출 → 품질 검수 결과."""
    reviewer = await _find_agent_by_type("reviewer")
    if not reviewer:
        return {"reviewed": False}
    api_prefix = reviewer.get("api_prefix", "")
    if not api_prefix:
        return {"reviewed": False}
    try:
        raw = await _exec_api_call(
            "POST",
            f"{api_prefix}/review",
            {"content": response_text},
            None,
            token,
        )
        parts = raw.split("\n", 1)
        status_code = int(parts[0].split()[1])
        if 200 <= status_code < 300 and len(parts) > 1:
            data = json.loads(parts[1])
            return {
                "reviewed": True,
                "verdict": data.get("verdict", "approved"),
                "score": float(data.get("score", 1.0)),
                "issues": data.get("issues", []),
            }
        return {"reviewed": False}
    except Exception:
        return {"reviewed": False}


class Orchestrator:
    def __init__(self) -> None:
        self._key = settings.anthropic_api_key
        self._client: anthropic.AsyncAnthropic | None = (
            anthropic.AsyncAnthropic(api_key=self._key) if self._key else None
        )
        # R19-3: 미터링 컨텍스트 (run/stream 진입 시 설정)
        self._meter_ctx: dict[str, str | None] = {}

    def _use_ollama(self, model: str | None) -> bool:
        """로컬 LLM 경로 사용 여부: 명시적 ollama(=local) 선택 OR Anthropic key 없음."""
        return model == "ollama" or not self._key

    @staticmethod
    def _budget(db: dict[str, str]) -> int:
        """R19-4: 히스토리 토큰 예산 (llm_context_budget)."""
        try:
            return int(db.get("llm_context_budget") or settings.llm_context_budget)
        except (TypeError, ValueError):
            return settings.llm_context_budget

    @staticmethod
    def _max_rounds(db: dict[str, str]) -> int:
        """tool-call 최대 루프 횟수 (llm_tool_max_rounds) — 최소 1 보장."""
        try:
            return max(1, int(db.get("llm_tool_max_rounds") or settings.llm_tool_max_rounds))
        except (TypeError, ValueError):
            return max(1, settings.llm_tool_max_rounds)

    async def _meter(
        self, provider: str, model: str, task: str, usage: dict | None, started: float
    ) -> None:
        """R19-3: LLM 호출 1건 기록 (best-effort)."""
        import time as _time
        await llm_metering.record(
            provider=provider,
            model=model,
            task=task,
            usage=usage,
            latency_ms=int((_time.monotonic() - started) * 1000),
            user_id=self._meter_ctx.get("user_id"),
            agent_key=self._meter_ctx.get("agent_key"),
        )

    async def _local_chat(
        self,
        task: str,
        messages: list[dict],
        system: str,
        usage_out: dict | None = None,
        db: dict[str, str] | None = None,
    ) -> str:
        """R19-1/2: 로컬 LLM 호출 — llm_routes[task] 우선, 미지정 시 기본 provider."""
        import time as _time
        db = db if db is not None else await _db_llm_settings()
        route = await llm_router.resolve(task, db)
        if route and route["provider"] != "anthropic":
            provider, model, base_url = route["provider"], route["model"], route["base_url"]
        else:
            provider, model, base_url = llm_providers.resolve_local(db)
        usage: dict = usage_out if usage_out is not None else {}
        started = _time.monotonic()
        try:
            return await llm_providers.chat(
                messages, system, provider=provider, model=model,
                base_url=base_url, usage_out=usage,
            )
        finally:
            await self._meter(provider, model, task, usage, started)

    async def _classify_intent(self, user_message: str) -> list[str]:
        if not self._client:
            return ["general"]
        import time as _time
        try:
            db = await _db_llm_settings()
            # R19-2: classify 라우트가 로컬 provider 를 지정하면 로컬 LLM 으로 분류
            route = await llm_router.resolve("classify", db)
            if route and route["provider"] != "anthropic":
                text = await self._local_chat(
                    "classify",
                    [{"role": "user", "content": user_message}],
                    _CLASSIFY_SYSTEM,
                    db=db,
                )
                intents: list[str] = json.loads(text.strip())
                disabled = await _disabled_agents()
                valid = [
                    i for i in intents
                    if i in _VALID_INTENTS and (i == "general" or i not in disabled)
                ]
                return valid or ["general"]
            orch_model = (route or {}).get("model") or db.get("orchestrator_model") or settings.orchestrator_model
            _usage: dict = {}
            _started = _time.monotonic()
            resp = await self._client.messages.create(
                model=orch_model,
                max_tokens=30,
                system=_CLASSIFY_SYSTEM,
                messages=[{"role": "user", "content": user_message}],
            )
            if getattr(resp, "usage", None):
                _usage = {"input_tokens": resp.usage.input_tokens or 0,
                          "output_tokens": resp.usage.output_tokens or 0}
            await self._meter("anthropic", orch_model, "classify", _usage, _started)
            intents = json.loads(resp.content[0].text.strip())
            disabled = await _disabled_agents()
            valid = [
                i for i in intents
                if i in _VALID_INTENTS and (i == "general" or i not in disabled)
            ]
            result = valid or ["general"]
            logger.warning("[orchestrator] intent: %s → %s", intents, result)
            return result
        except Exception as exc:
            logger.warning("[orchestrator] intent 분류 실패, general 폴백: %s", exc)
            return ["general"]

    def _make_agent(self, intent: str) -> Any | None:
        cls = _AGENT_MAP.get(intent)
        if cls is None:
            return None
        if isinstance(cls, str) and cls.startswith("a2a://"):
            return None
        return cls()

    async def _claude_general(self, user_message: str, history: list[dict], system_prompt: str) -> str:
        return await self._claude_with_tools(user_message, history, system_prompt, token=None)

    async def _claude_with_tools(
        self,
        user_message: str,
        history: list[dict],
        system_prompt: str,
        token: str | None = None,
        usage_out: dict | None = None,
    ) -> str:
        if not self._client:
            raise RuntimeError("Anthropic client not configured")
        import time as _time
        db = await _db_llm_settings()
        # R19-2: tools 라우트의 anthropic model 오버라이드 (로컬 provider 지정 시 로컬 경로)
        route = await llm_router.resolve("tools", db)
        if route and route["provider"] != "anthropic":
            history_c, was_compressed = compress_history(list(history), self._budget(db))
            if was_compressed and usage_out is not None:
                usage_out["compressed"] = True
            messages = history_c + [{"role": "user", "content": user_message}]
            return await self._local_chat("tools", messages, system_prompt, usage_out=usage_out, db=db)
        orch_model = (route or {}).get("model") or db.get("orchestrator_model") or settings.orchestrator_model
        # R19-4: 히스토리 토큰 예산 초과 시 압축
        history_c, was_compressed = compress_history(list(history), self._budget(db))
        if was_compressed and usage_out is not None:
            usage_out["compressed"] = True
        messages = history_c + [{"role": "user", "content": user_message}]
        _meter_usage: dict = {}
        _started = _time.monotonic()

        for _ in range(self._max_rounds(db)):  # max tool-call rounds (llm_tool_max_rounds)
            resp = await self._client.messages.create(
                model=orch_model,
                max_tokens=2048,
                system=system_prompt,
                messages=messages,
                tools=[_TOOL_CALL_API],
            )
            if getattr(resp, "usage", None):
                _meter_usage["input_tokens"] = _meter_usage.get("input_tokens", 0) + (resp.usage.input_tokens or 0)
                _meter_usage["output_tokens"] = _meter_usage.get("output_tokens", 0) + (resp.usage.output_tokens or 0)
            if usage_out is not None and getattr(resp, "usage", None):
                usage_out["input_tokens"] = usage_out.get("input_tokens", 0) + (resp.usage.input_tokens or 0)
                usage_out["output_tokens"] = usage_out.get("output_tokens", 0) + (resp.usage.output_tokens or 0)
            if resp.stop_reason != "tool_use":
                await self._meter("anthropic", orch_model, "tools", _meter_usage, _started)
                return "".join(
                    b.text for b in resp.content if hasattr(b, "text")
                )
            messages.append({"role": "assistant", "content": resp.content})
            tool_results = []
            for block in resp.content:
                if block.type == "tool_use":
                    inp = block.input
                    result = await _exec_api_call(
                        inp.get("method", "GET"),
                        inp.get("path", ""),
                        inp.get("body"),
                        inp.get("params"),
                        token,
                    )
                    logger.warning("[orchestrator] tool call_api %s %s → %s", inp.get("method"), inp.get("path"), result[:120])
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result,
                    })
            messages.append({"role": "user", "content": tool_results})

        await self._meter("anthropic", orch_model, "tools", _meter_usage, _started)
        return "처리 중 오류가 발생했습니다. 다시 시도해 주세요."

    async def _ollama_general(self, user_message: str, history: list[dict], system_prompt: str,
                              usage_out: dict | None = None) -> str:
        db = await _db_llm_settings()
        history_c, was_compressed = compress_history(list(history), self._budget(db))
        if was_compressed and usage_out is not None:
            usage_out["compressed"] = True
        messages = history_c + [{"role": "user", "content": user_message}]
        return await self._local_chat("chat", messages, system_prompt, usage_out=usage_out, db=db)

    async def _ollama_with_tools(
        self,
        user_message: str,
        history: list[dict],
        system_prompt: str,
        token: str | None = None,
        usage_out: dict | None = None,
    ) -> str:
        """로컬 LLM용 prompt-based tool calling: <api_call>JSON</api_call> 태그 파싱.

        R19-1/2: Ollama 외 llama.cpp/vLLM 도 동일 태그 방식 사용 — llm_routes['tools']
        가 로컬 provider 를 지정하면 해당 백엔드, 아니면 기본 local provider.
        """
        import re as _re
        import time as _time

        db = await _db_llm_settings()
        _route = await llm_router.resolve("tools", db)
        if _route and _route["provider"] != "anthropic":
            _provider, _model, _base_url = _route["provider"], _route["model"], _route["base_url"]
        else:
            _provider, _model, _base_url = llm_providers.resolve_local(db)

        # Extract only the addon API specs section for Ollama (short & focused)
        addon_spec = await _addon_api_specs()
        builtin_spec = await _builtin_api_specs()
        agents_block = await _active_agents_block()
        ollama_sys = (
            "You are the AI assistant of the SeCuardian-Basic platform. Respond in Korean.\n\n"
            "## SCOPE (top priority)\n"
            "Answer ONLY about SeCuardian-Basic platform features, services, and agents.\n"
            "Interpret terms by the platform definitions below — e.g. 'Orchestrator' is SeCuardian-Basic's "
            "central routing agent, NEVER a Kubernetes/generic concept.\n"
            "For questions unrelated to the platform, reply: "
            "\"SeCuardian-Basic 플랫폼 기능·서비스 범위의 질문에만 답변할 수 있습니다.\"\n"
            "For definition/explanation questions (무엇인지/정의/설명/기능 알려줘), answer in text from the "
            "agent descriptions below — do NOT call any API.\n"
            "After the refusal sentence, NEVER append tutorials, step-by-step guides, commands, or any "
            "generic knowledge. End the answer there (optionally one sentence pointing to a related agent).\n\n"
            + (agents_block + "\n\n" if agents_block else "")
            + "## CRITICAL RULE: API CALLS\n"
            "To perform any data operation, output EXACTLY this tag (nothing else on the line):\n"
            "<api_call>{\"method\":\"METHOD\",\"path\":\"/path\",\"body\":{...}}</api_call>\n"
            "Do NOT write the result yourself. Wait for the real API response.\n"
            "Do NOT hallucinate endpoints. ONLY use paths listed below.\n\n"
            "## Built-in System APIs\n"
            "  GET  /api/agent-config/           — list ALL agents (built-in + addon, full config)\n"
            "  GET  /api/addon-agents/            — list addon-only agents (upload/toggle management)\n"
            + (builtin_spec + "\n" if builtin_spec else "")
            + "\n"
            "## Examples\n"
            "User: 에이전트 목록 보여줘\n"
            "Assistant: <api_call>{\"method\":\"GET\",\"path\":\"/api/agent-config/\"}</api_call>\n\n"
            "User: 사용 가능한 에이전트 알려줘\n"
            "Assistant: <api_call>{\"method\":\"GET\",\"path\":\"/api/agent-config/\"}</api_call>\n\n"
            "User: 게시판에 '안녕' 글 써줘\n"
            "Assistant: <api_call>{\"method\":\"POST\",\"path\":\"/api/addon/board/posts\","
            "\"body\":{\"title\":\"안녕\",\"content\":\"안녕\"}}</api_call>\n\n"
            "User: usermanager에 hong 사용자 추가\n"
            "Assistant: <api_call>{\"method\":\"POST\",\"path\":\"/api/addon/usermanager/users\","
            "\"body\":{\"username\":\"hong\",\"role\":\"user\"}}</api_call>\n\n"
            "User: 안녕?\n"
            "Assistant: 안녕하세요!\n\n"
            "User: Orchestrator가 무엇인지 알려줘\n"
            "Assistant: Orchestrator는 사용자 요청의 의도를 분류해 적합한 에이전트로 라우팅·합성하는 "
            "SeCuardian-Basic 플랫폼의 중앙 오케스트레이터 에이전트입니다.\n\n"
            "User: kubernetes에서 pod를 배포하는 방법 알려줘\n"
            "Assistant: SeCuardian-Basic 플랫폼 기능·서비스 범위의 질문에만 답변할 수 있습니다.\n\n"
            "User: 파이썬 강좌 추천해줘\n"
            "Assistant: SeCuardian-Basic 플랫폼 기능·서비스 범위의 질문에만 답변할 수 있습니다.\n\n"
        )
        platform_rules = _load_platform_instructions()
        if platform_rules:
            ollama_sys += "## Platform Instructions\n" + platform_rules + "\n\n"
        if addon_spec:
            ollama_sys += "## Available APIs (exact paths and fields)\n" + addon_spec + "\n\n"
        # Append any custom instructions from the full prompt (last section only)
        custom_parts = [p for p in system_prompt.split("\n\n") if "맞춤지침" in p or "instruction" in p.lower()]
        if custom_parts:
            ollama_sys += "\n".join(custom_parts)

        # 메시지가 특정 에이전트를 지목하면 대상 prefix 를 명시 — 소형 모델이
        # 예시(VASCA) 경로로 앵커링해 오라우팅하는 것을 방지
        target = await _resolve_capability_target(user_message)
        if target:
            ollama_sys += (
                f"\n## Target Agent Hint\n"
                f"The user is asking about '{target[0]}'. "
                f"Use ONLY API paths under {target[1]} for this request.\n"
            )

        # R19-4: 히스토리 토큰 예산 초과 시 압축
        _history_c, _was_compressed = compress_history(list(history), self._budget(db))
        if _was_compressed and usage_out is not None:
            usage_out["compressed"] = True
        messages: list[dict] = _history_c + [{"role": "user", "content": user_message}]

        _usage: dict = usage_out if usage_out is not None else {}
        _started = _time.monotonic()
        try:
            return await self._ollama_tool_rounds(
                messages, ollama_sys, _provider, _model, _base_url, _usage, token, _re,
                max_rounds=self._max_rounds(db),
            )
        finally:
            await self._meter(_provider, _model, "tools", _usage, _started)

    async def _ollama_tool_rounds(
        self,
        messages: list[dict],
        ollama_sys: str,
        _provider: str,
        _model: str,
        _base_url: str,
        _usage: dict,
        token: str | None,
        _re: Any,
        max_rounds: int = 6,
    ) -> str:
        last_error: str = ""
        last_fail_sig: tuple | None = None
        for rnd in range(max_rounds):
            text = await llm_providers.chat(
                messages, ollama_sys, provider=_provider, model=_model,
                base_url=_base_url, usage_out=_usage,
            )
            # 일부 모델이 마크다운 이스케이프(<api\_call>)로 응답 — 태그 파싱 전 정규화
            text = text.replace("\\_", "_")
            logger.warning("[orchestrator] ollama round %d response: %.120s", rnd, text)

            # Try strict match first, fallback to brace-counting (handles missing </api_call>)
            match = _re.search(r"<api_call>\s*(.*?)\s*</api_call>", text, _re.DOTALL)
            if not match:
                # Extract JSON by finding <api_call> + first complete {…} object
                tag_idx = text.find("<api_call>")
                if tag_idx == -1:
                    # 오류 재시도 후 태그 없는 응답 = 자가수정 포기 — 원시 오류 JSON
                    # 을 그대로 되풀이하는 경우가 많아 친화적 오류 메시지로 대체
                    if last_error:
                        return last_error
                    if _looks_like_prompt_echo(text):
                        return "요청을 처리하지 못했습니다. 다시 시도해 주세요."
                    return text  # 일반 텍스트 응답 (태그 없음 — 그대로 노출 가능)
                json_start = text.find("{", tag_idx)
                if json_start == -1:
                    return _safe_ollama_text(text, last_error)
                depth = 0
                json_end = -1
                for ci, ch in enumerate(text[json_start:]):
                    if ch == "{":
                        depth += 1
                    elif ch == "}":
                        depth -= 1
                        if depth == 0:
                            json_end = json_start + ci + 1
                            break
                if json_end == -1:
                    return _safe_ollama_text(text, last_error)
                json_str = text[json_start:json_end]
            else:
                json_str = match.group(1)

            try:
                call = json.loads(json_str)
                result = await _exec_api_call(
                    call.get("method", "GET"),
                    call.get("path", ""),
                    call.get("body"),
                    call.get("params"),
                    token,
                )
                logger.warning(
                    "[orchestrator] ollama api_call %s %s → %s",
                    call.get("method"), call.get("path"), result[:200],
                )
                # On 4xx/5xx, feed error back so Ollama can self-correct
                status_line = result.split("\n", 1)[0]
                try:
                    status_code = int(status_line.split()[1])
                except (IndexError, ValueError):
                    status_code = 0
                if 400 <= status_code < 600:
                    try:
                        err_data = json.loads(result.split("\n", 1)[1]) if "\n" in result else {}
                    except Exception:
                        err_data = {}
                    last_error = (
                        _format_api_error(status_code, err_data)
                        + f"\n(요청: {call.get('method', 'GET')} {call.get('path', '')})"
                    )
                    # 동일 요청이 동일 오류로 반복 = 자가수정 실패 — 남은 라운드 낭비 방지 즉시 중단
                    fail_sig = (call.get("method"), call.get("path"), status_code)
                    if fail_sig == last_fail_sig:
                        logger.warning(
                            "[orchestrator] ollama 동일 API 오류 반복 (%s %s → %s) — 루프 조기 종료",
                            *fail_sig,
                        )
                        return last_error
                    last_fail_sig = fail_sig
                    # 모델에는 원시 오류를 전달해 자가수정 유도 (사용자에게는 미노출)
                    messages.append({"role": "assistant", "content": text})
                    messages.append({"role": "user", "content": f"API 오류: {result[:300]}\n위 요청을 수정하여 다시 시도해 주세요. 오류 내용을 사용자에게 그대로 보여주지 마세요."})
                    continue
                return _format_api_result(call.get("method", ""), call.get("path", ""), result)
            except Exception as exc:
                logger.warning("[orchestrator] ollama api_call 파싱 실패: %s", exc)
                # 규칙 예시 태그(<api_call>{"method":"METHOD",...}) echo 시 JSON 파싱이 실패하며
                # 여기로 진입 — 원문을 그대로 노출하면 내부 프롬프트가 유출된다
                return _safe_ollama_text(text, last_error)

        # max_rounds 소진 — API 오류 반복 (예: 존재하지 않는 경로 반복 호출)
        return last_error or (
            "❌ 요청하신 작업에 맞는 API를 찾지 못했습니다. "
            "요청을 다르게 표현해 주시거나, 지원되는 기능인지 확인해 주세요."
        )

    async def _synthesize(self, results: dict[str, str], user_message: str) -> str:
        if not self._client:
            return "\n\n".join(f"[{_AGENT_LABELS.get(k, k)}]\n{v}" for k, v in results.items())
        import time as _time
        db = await _db_llm_settings()
        combined = "\n\n".join(
            f"[{_AGENT_LABELS.get(k, k)}]\n{v}" for k, v in results.items()
        )
        _synth_system = "Synthesize multiple agent responses into a clear, unified final answer for the user."
        _synth_user = f"Original question: {user_message}\n\n{combined}"
        try:
            # R19-2: synthesize 라우트가 로컬 provider 를 지정하면 로컬 LLM 으로 합성
            route = await llm_router.resolve("synthesize", db)
            if route and route["provider"] != "anthropic":
                return await self._local_chat(
                    "synthesize", [{"role": "user", "content": _synth_user}], _synth_system, db=db,
                )
            orch_model = (route or {}).get("model") or db.get("orchestrator_model") or settings.orchestrator_model
            _usage: dict = {}
            _started = _time.monotonic()
            resp = await self._client.messages.create(
                model=orch_model,
                max_tokens=2048,
                system=_synth_system,
                messages=[{"role": "user", "content": _synth_user}],
            )
            if getattr(resp, "usage", None):
                _usage = {"input_tokens": resp.usage.input_tokens or 0,
                          "output_tokens": resp.usage.output_tokens or 0}
            await self._meter("anthropic", orch_model, "synthesize", _usage, _started)
            return resp.content[0].text
        except Exception:
            return combined

    async def run(
        self, user_message: str, history: list[dict], model: str | None = None,
        user_id: str | None = None, token: str | None = None,
        agent_key: str | None = None,
    ) -> str:
        logger.warning("[orchestrator] run() called, msg=%.40s", user_message)
        self._meter_ctx = {"user_id": user_id, "agent_key": agent_key}  # R19-3
        rule = await match_rule_async(user_message)
        if rule:
            action = rule.get("action", {})
            if action.get("type") == "api_call":
                raw = await _exec_api_call(action["method"], action["path"], None, None, token)
                return await format_response_async(rule, raw)
            if action.get("type") in ("disabled_check", "static_text"):
                return format_response(rule, "")
        if _is_capability_question(user_message):
            target = await _resolve_capability_target(user_message, agent_key)
            if target:
                cap = _agent_capabilities_md(*target)
                if cap:
                    logger.warning("[orchestrator] capability rule: %s", target[0])
                    return cap
        sys_prompt = await _build_system_prompt(user_id, agent_key)
        if self._use_ollama(model):
            return await self._ollama_with_tools(user_message, history, sys_prompt, token=token)

        intents = await self._classify_intent(user_message)
        if len(intents) == 1:
            agent = self._make_agent(intents[0])
            if agent:
                return await agent.run(user_message, history)
            try:
                return await self._claude_with_tools(user_message, history, sys_prompt, token=token)
            except Exception as exc:
                logger.warning("[orchestrator] Claude 실패, Ollama 폴백: %s", exc)
                return await self._ollama_with_tools(user_message, history, sys_prompt, token=token)

        tasks = []
        for intent in intents:
            agent = self._make_agent(intent)
            if agent:
                tasks.append((intent, agent.run(user_message, history)))
        if not tasks:
            return await self._ollama_with_tools(user_message, history, sys_prompt, token=token)

        results_list = await asyncio.gather(*[t for _, t in tasks])
        results = {intent: r for (intent, _), r in zip(tasks, results_list)}
        return await self._synthesize(results, user_message)

    async def stream(
        self, user_message: str, history: list[dict], model: str | None = None,
        user_id: str | None = None, token: str | None = None,
        agent_key: str | None = None,
    ) -> AsyncGenerator[str, None]:
        logger.warning("[orchestrator] stream() called, msg=%.40s", user_message)
        self._meter_ctx = {"user_id": user_id, "agent_key": agent_key}  # R19-3
        try:
            rule = await match_rule_async(user_message)
            if rule:
                import re as _re
                action = rule.get("action", {})
                rule_text: str | None = None
                if action.get("type") in ("disabled_check", "static_text"):
                    rule_text = format_response(rule, "")
                elif action.get("type") == "api_call":
                    raw = await _exec_api_call(action["method"], action["path"], None, None, token)
                    rule_text = await format_response_async(rule, raw)
                if rule_text is not None:
                    yield f"event: intent\ndata: {json.dumps({'intents': ['keyword_rule']})}\n\n"
                    yield f"event: agent_start\ndata: {json.dumps({'agent': rule['id'], 'label': rule.get('description', rule['id'])})}\n\n"
                    for tok in _re.findall(r"\S+|\s+", rule_text):
                        yield f"event: delta\ndata: {json.dumps({'text': tok})}\n\n"
                        if not tok.isspace():
                            await asyncio.sleep(0.03)
                    yield "event: done\ndata: {}\n\n"
                    return

            # 공통 기능안내 룰 — 대상 에이전트 엔드포인트를 app.routes 에서 동적 생성
            if _is_capability_question(user_message):
                target = await _resolve_capability_target(user_message, agent_key)
                logger.warning("[orchestrator] capability target=%s (agent_key=%s)", target, agent_key)
                if target:
                    cap = _agent_capabilities_md(*target)
                    if cap:
                        import re as _re
                        logger.warning("[orchestrator] capability rule: %s", target[0])
                        yield f"event: intent\ndata: {json.dumps({'intents': ['capability_rule']})}\n\n"
                        yield f"event: agent_start\ndata: {json.dumps({'agent': 'capabilities', 'label': f'{target[0]} 기능 안내'})}\n\n"
                        for tok in _re.findall(r"\S+|\s+", cap):
                            yield f"event: delta\ndata: {json.dumps({'text': tok})}\n\n"
                            if not tok.isspace():
                                await asyncio.sleep(0.03)
                        yield "event: done\ndata: {}\n\n"
                        return
            sys_prompt = await _build_system_prompt(user_id, agent_key)

            # ── Ollama 경로 (명시적 선택 또는 Anthropic key 없음) ──────────
            if self._use_ollama(model):
                _local_db = await _db_llm_settings()
                _lp, _lm, _ = llm_providers.resolve_local(_local_db)
                yield f"event: intent\ndata: {json.dumps({'intents': ['general']})}\n\n"
                yield f"event: agent_start\ndata: {json.dumps({'agent': 'general', 'label': f'일반 응답 ({_lp})'})}\n\n"
                usage: dict = {}
                text = await self._ollama_with_tools(user_message, history, sys_prompt, token=token, usage_out=usage)
                yield f"event: delta\ndata: {json.dumps({'text': text})}\n\n"
                yield f"event: done\ndata: {json.dumps({'usage': usage, 'model': _lm or settings.ollama_model})}\n\n"
                return

            # ── Claude 경로 ────────────────────────────────────────────────
            intents = await self._classify_intent(user_message)
            yield f"event: intent\ndata: {json.dumps({'intents': intents})}\n\n"

            # F25-1: capability 기반 Registry 검색 (옵트인)
            if await _get_setting_bool("registry_dynamic_routing"):
                for intent in intents:
                    if intent not in _AGENT_MAP:
                        candidates = await _registry_find_by_verb(intent)
                        yield (
                            f"event: registry_miss\ndata: {json.dumps({'type': 'registry_miss', 'intent': intent, 'candidates': [c['agent_key'] for c in candidates], 'fallback': 'general'})}\n\n"
                        )

            # F25-3: HITL 게이트 (옵트인)
            if await _get_setting_bool("hitl_gate_enabled"):
                for intent in intents:
                    if intent in _HIGH_RISK_INTENTS:
                        hitl = await _find_agent_by_type("hitl")
                        if hitl:
                            import uuid as _uuid
                            approval_id = str(_uuid.uuid4())
                            yield (
                                f"event: hitl_pending\ndata: {json.dumps({'type': 'hitl_pending', 'approval_id': approval_id, 'intent': intent, 'message': '승인 대기 중'})}\n\n"
                            )
                            yield "event: done\ndata: {}\n\n"
                            return

            # 응답 수집 (F25-2 reviewer gate 적용 시 텍스트 모아야 함)
            reviewer_gate = await _get_setting_bool("reviewer_gate_enabled")
            usage = {}
            _db = await _db_llm_settings()
            used_model = _db.get("orchestrator_model") or settings.orchestrator_model
            for intent in intents:
                yield f"event: agent_start\ndata: {json.dumps({'agent': intent, 'label': _AGENT_LABELS.get(intent, intent)})}\n\n"
                agent = self._make_agent(intent)

                if agent and hasattr(agent, "stream"):
                    async for chunk in agent.stream(user_message, history):
                        yield chunk
                else:
                    try:
                        text = await self._claude_with_tools(user_message, history, sys_prompt, token=token, usage_out=usage)
                    except Exception as exc:
                        logger.warning("[orchestrator] Claude 실패, 로컬 LLM 폴백: %s", exc)
                        text = await self._ollama_with_tools(user_message, history, sys_prompt, token=token, usage_out=usage)
                        _, used_model, _ = llm_providers.resolve_local(_db)
                        used_model = used_model or settings.ollama_model

                    # F25-2: reviewer gate (옵트인)
                    if reviewer_gate:
                        review = await _call_reviewer_gate(text, token)
                        if review.get("reviewed"):
                            yield (
                                f"event: review_gate\ndata: {json.dumps({'type': 'review_gate', 'verdict': review.get('verdict', 'approved'), 'score': review.get('score', 1.0)})}\n\n"
                            )
                            if review.get("verdict") == "rejected":
                                issues = review.get("issues", [])
                                yield f"event: delta\ndata: {json.dumps({'text': f'[품질 검수 반려] {issues}'})}\n\n"
                                yield "event: done\ndata: {}\n\n"
                                return

                    yield f"event: delta\ndata: {json.dumps({'text': text})}\n\n"

            yield f"event: done\ndata: {json.dumps({'usage': usage, 'model': used_model})}\n\n"

        except Exception as exc:
            logger.error("[orchestrator] 스트림 오류: %s", exc)
            yield f"event: error\ndata: {json.dumps({'message': str(exc)})}\n\n"
