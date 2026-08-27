"""E2 — scan_zip 정적 검증(F8/D12) + worker 정책 + 의존성(F6/D10)."""
import io
import zipfile

import pytest

from util_addon import ROOT, make_zip
from app.services import addon_deps
from app.services.addon_validator import is_worker_package, scan_zip


def _zf(data: bytes) -> zipfile.ZipFile:
    return zipfile.ZipFile(io.BytesIO(data))


def test_clean_zip_passes():
    _, data = make_zip("Clean", {
        "Clean-app.py": "from fastapi import APIRouter\nrouter = APIRouter()\n",
        "Clean-meta.json": "{}",
        "Clean-sql.sql": "CREATE TABLE IF NOT EXISTS t (id INTEGER);",
    })
    report = scan_zip(_zf(data))
    assert not report.blocked and report.summary().startswith("CRITICAL 0건")


def test_os_system_blocked():
    _, data = make_zip("Evil", {"Evil-app.py": "import os\nos.system('rm -rf /')\n"})
    report = scan_zip(_zf(data))
    assert report.blocked
    assert any(f.rule == "dangerous-call" for f in report.critical)


def test_disallowed_file_type_blocked_for_addon():
    _, data = make_zip("Bin", {"Bin-app.py": "router = None\n", "bin/tool": b"\x7fELF"})
    assert scan_zip(_zf(data)).blocked


def test_worker_policy_allows_binaries():
    """*_worker 패키지는 .go/.cpp/Dockerfile/bin/ 바이너리 허용 (R22-4)."""
    _, data = make_zip("X_worker", {
        "X_worker/main.go": "package main\n",
        "X_worker/src/engine.cpp": "int main(){}",
        "X_worker/include/engine.hpp": "#pragma once",
        "X_worker/Dockerfile": "FROM alpine\n",
        "X_worker/bin/x": b"\x7fELF binary",
        "X_worker/helper.py": "import subprocess\n",  # worker 는 WARNING 으로 완화
    })
    assert is_worker_package("X_worker")
    report = scan_zip(_zf(data), "worker")
    assert not report.blocked and len(report.warnings) >= 1
    # 동일 zip 을 addon 정책으로 스캔하면 차단
    assert scan_zip(_zf(data), "addon").blocked


def test_bundled_worker_zips_scan_clean():
    """worker zip 은 SeCMP 자산 — Basic 저장소에 동봉하지 않음. 형제 프로젝트 없으면 skip."""
    mp = ROOT.parent / "SeCuardian-Marketplace" / "marketplace-assets" / "security"
    if not mp.is_dir():
        pytest.skip("SeCuardian-Marketplace 자산 미존재 — 통합 환경 전용 검사")
    for name in ("VASCA_worker.zip", "BehaviorNotiService_worker.zip"):
        with zipfile.ZipFile(mp / name) as zf:
            assert not scan_zip(zf, "worker").blocked, name


def test_deps_missing_and_allowlist():
    assert addon_deps.missing(["httpx", "no-such-package-xyz>=1"]) == ["no-such-package-xyz>=1"]
    assert addon_deps.check_allowlist(["httpx"]) == []  # 빈 allowlist = 전체 허용
    from app.core.config import settings
    old = settings.addon_deps_allowlist
    settings.addon_deps_allowlist = "httpx,requests"
    try:
        assert addon_deps.check_allowlist(["HTTPX>=0.27"]) == []
        assert addon_deps.check_allowlist(["evilpkg"]) == ["evilpkg"]
    finally:
        settings.addon_deps_allowlist = old


async def test_deps_ensure_denied_by_allowlist():
    from app.core.config import settings
    old = settings.addon_deps_allowlist
    settings.addon_deps_allowlist = "httpx"
    try:
        with pytest.raises(addon_deps.DependencyError):
            await addon_deps.ensure(["evilpkg==1.0"])
    finally:
        settings.addon_deps_allowlist = old
