"""E3 통합 검증 — SeCMP marketplace-assets 의 전 Agent ZIP 을 실제 업로드 파이프라인으로 설치.

Basic 저장소는 Agent 미동봉(순수 코어). 형제 SeCuardian-Marketplace 가 없으면 skip.
worker zip(_worker 접미)은 업로드 거부가 정상 동작.
"""
from pathlib import Path

import pytest

from util_addon import ROOT, upload

MP = ROOT.parent / "SeCuardian-Marketplace" / "marketplace-assets"

pytestmark = pytest.mark.skipif(not MP.is_dir(), reason="SeCMP 자산 미존재 — 통합 환경 전용")


def _zips(category: str) -> list[Path]:
    return sorted((MP / category).glob("*.zip"))


@pytest.mark.anyio
async def test_all_security_agent_zips_install(client, auth):
    agent_zips = [z for z in _zips("security") if not z.stem.endswith("_worker")]
    assert len(agent_zips) >= 32, [z.name for z in agent_zips]  # 기존 13 + 이식 8 + SeCMP E9 7 + E10 4
    installed = []
    for z in agent_zips:
        r = await upload(client, auth, z.name, z.read_bytes(), force=True)
        assert r.status_code == 200, (z.name, r.status_code, r.text[:300])
        installed.append(z.stem.lower())
    # 라우트 활성 확인
    r = await client.get("/api/addon-agents/", headers=auth)
    keys = {a["agent_key"] for a in r.json()["addons"]}
    missing = [k for k in installed if k not in keys]
    assert not missing, missing


@pytest.mark.anyio
async def test_worker_zip_upload_rejected(client, auth):
    for z in [z for z in _zips("security") if z.stem.endswith("_worker")]:
        r = await upload(client, auth, z.name, z.read_bytes(), force=True)
        assert r.status_code == 400, (z.name, r.status_code, r.text[:200])


@pytest.mark.anyio
async def test_addon_template_zips_install(client, auth):
    for z in [x for x in _zips("addon") + _zips("utilities") if not x.stem.endswith("_worker")]:
        r = await upload(client, auth, z.name, z.read_bytes(), force=True)
        assert r.status_code == 200, (z.name, r.status_code, r.text[:300])
