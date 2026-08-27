"""Addon 파이썬 의존성 설치 (PRD F6 / D10 — MAS-Basic addon_deps 이식).

manifest `dependencies.python` 의 PEP 508 스펙을 현재 인터프리터 환경에 `uv pip install` 로 설치한다.
- settings.addon_deps_install=False 면 설치를 건너뛰고 미충족 목록만 반환(운영자가 수동 설치)
- settings.addon_deps_allowlist (쉼표 구분 패키지명): 비어 있으면 전체 허용, 지정 시 목록 외 패키지는 거부
- settings.addon_deps_find_links 지정 시 오프라인 wheel 디렉터리 우선(`--find-links`)
- 실제 설치 전 `--dry-run` 으로 해석·충돌을 검사하고, 실패 시 설치를 시도하지 않는다
- 설치 전 이미 충족된 스펙은 건너뜀 (importlib.metadata)
"""
import asyncio
import logging
import re
import shutil
import sys
from importlib import metadata

from app.core.config import settings

logger = logging.getLogger("uvicorn.error")

_NAME_RE = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)")


class DependencyError(RuntimeError):
    pass


def _dist_name(spec: str) -> str:
    m = _NAME_RE.match(spec)
    return (m.group(1) if m else spec).strip()


def _norm(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def _installed_version(name: str) -> str | None:
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return None


def missing(specs: list[str]) -> list[str]:
    """설치되지 않은(또는 버전 확인 불가) 스펙 목록. 버전 제약은 packaging 없이 존재 여부만 검사."""
    return [spec for spec in specs if _installed_version(_dist_name(spec)) is None]


def _allowlist() -> set[str]:
    raw = settings.addon_deps_allowlist or ""
    return {_norm(x) for x in raw.split(",") if x.strip()}


def check_allowlist(specs: list[str]) -> list[str]:
    """허용목록 위반 스펙 목록 (빈 allowlist = 전체 허용)."""
    allow = _allowlist()
    if not allow:
        return []
    return [s for s in specs if _norm(_dist_name(s)) not in allow]


async def _run(cmd: list[str]) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
    )
    out, _ = await proc.communicate()
    return proc.returncode or 0, out.decode(errors="replace")


async def ensure(specs: list[str]) -> dict:
    """의존성 보장. 반환 {"installed": [...], "skipped": [...], "missing": [...]}.

    허용목록 위반·해석 실패(dry-run)·설치 실패 시 DependencyError.
    """
    specs = [s for s in (specs or []) if s and s.strip()]
    result: dict = {"installed": [], "skipped": [], "missing": []}
    if not specs:
        return result
    denied = check_allowlist(specs)
    if denied:
        raise DependencyError(
            f"허용목록(ADDON_DEPS_ALLOWLIST)에 없는 의존성: {', '.join(denied)}"
        )
    need = missing(specs)
    result["skipped"] = [s for s in specs if s not in need]
    if not need:
        return result
    if not settings.addon_deps_install:
        result["missing"] = need
        return result

    uv = shutil.which("uv")
    if uv:
        base = [uv, "pip", "install", "--python", sys.executable]
    else:
        base = [sys.executable, "-m", "pip", "install"]
    if settings.addon_deps_find_links:
        base += ["--find-links", settings.addon_deps_find_links]

    # 1) --dry-run — 스펙 해석·버전 충돌을 설치 전에 검사 (환경 오염 방지)
    rc, text = await _run([*base, "--dry-run", *need])
    if rc != 0:
        tail = "\n".join(text.strip().splitlines()[-8:])
        raise DependencyError(f"의존성 해석 실패(dry-run: {' '.join(need)}):\n{tail}")

    # 2) 실제 설치
    logger.info("[addon_deps] installing: %s", " ".join(need))
    rc, text = await _run([*base, *need])
    if rc != 0:
        tail = "\n".join(text.strip().splitlines()[-8:])
        raise DependencyError(f"의존성 설치 실패 ({' '.join(need)}):\n{tail}")
    still = missing(need)
    if still:
        raise DependencyError(f"설치 후에도 import 불가: {still}")
    result["installed"] = need
    return result
