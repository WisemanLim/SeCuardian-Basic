"""Addon SDK — Addon Agent 가 import 해도 되는 **유일한 공개 모듈** (PRD F4 / B-1.2).

    from app.addon_sdk import get_current_user, require_role, fetch_all, fetch_one, \
        execute_write, execute_insert, PH, IS_SQLITE, settings, BASE_DIR, call_llm, \
        addon_data_dir, addon_file, norm_descriptions, parse_lang_map

호환성 정책
- 공개 심볼은 SemVer(__sdk_version__)로 관리하며 MAJOR 변경 없이 제거하지 않는다.
- 기존 `from app.core.deps import ...`, `from app.db import _PH, ...` import 는 해당 모듈이 그대로
  유지되므로 계속 동작한다(호환 shim). 단, 신규 Addon 은 SDK 만 사용할 것 (make test 가 경고).
- Addon 은 `app.services.<도메인>` 이나 다른 Addon 의 파이썬 모듈을 import 하지 않는다.
  데이터 공유는 테이블(manifest tables_owned) 또는 HTTP(/api/addon/{other}/...) 로만.
"""
from pathlib import Path

from app.addon_agent_loader import addon_data_dir  # noqa: F401
from app.core.config import BASE_DIR, settings  # noqa: F401
from app.core.deps import get_current_user, require_role  # noqa: F401
from app.core.i18n import norm_descriptions, parse_lang_map  # noqa: F401
from app.db import _IS_SQLITE as IS_SQLITE  # noqa: F401
from app.db import _PH as PH  # noqa: F401
from app.db import execute_insert, execute_write, fetch_all, fetch_one  # noqa: F401
from app.services.llm_fallback import call_ollama  # noqa: F401
from app.services.llm_providers import chat as call_local_llm  # noqa: F401

__sdk_version__ = "1.0.0"


async def call_llm(prompt: str, system: str = "", model: str | None = None) -> str:
    """로컬 LLM 호출 (settings.local_llm_provider: ollama|llamacpp|vllm). 도메인 Addon 의 간단 생성용.

    Anthropic 직접 호출이 필요하면 Addon 에서 `anthropic` SDK 를 직접 사용하고 settings.anthropic_api_key 를 쓴다.
    실패 시 RuntimeError.
    """
    return await call_local_llm([{"role": "user", "content": prompt}], system, model=model)


def addon_file(agent_key: str, *parts: str) -> Path:
    """Addon 배포 디렉터리 내 파일 경로 (샘플 데이터 등 읽기 전용 자원)."""
    return Path(settings.addon_deployed_path) / agent_key / Path(*parts)


__all__ = [
    "__sdk_version__",
    "BASE_DIR", "settings",
    "get_current_user", "require_role",
    "fetch_all", "fetch_one", "execute_write", "execute_insert", "PH", "IS_SQLITE",
    "call_llm", "call_local_llm", "call_ollama",
    "addon_data_dir", "addon_file",
    "norm_descriptions", "parse_lang_map",
]
