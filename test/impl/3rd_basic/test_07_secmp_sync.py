"""3rd_basic — SeCMP 자산 동기(E9 신규 7종 + E10 패키징 4종) 편입 검증.

addon-agents/zip/ 픽스처가 SeCMP marketplace-assets 와 1:1(이름·sha256) 일치하고,
신규 11종이 클린 Basic 에 설치되며, E10 4종의 worker-guide 가 API 로 서빙되는지 확인한다.
"""
import hashlib
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "1st_basic"))
from util_addon import ROOT, upload  # noqa: E402

ZIP_DIR = ROOT / "addon-agents" / "zip"
MP = ROOT.parent / "SeCuardian-Marketplace" / "marketplace-assets"

E9 = ["agentic-threat-model", "attack-surface-recon", "api-vuln-scan", "cicd-security-scan",
      "ad-security-scan", "malware-hunt", "soc-intel-fusion"]
E10 = ["logto-monitor", "istio-mtls", "wireproxy-ztna", "observability-monitor"]


def _sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def test_fixture_zip_inventory():
    names = {z.name for z in ZIP_DIR.glob("*.zip")}
    assert len(names) == 50, sorted(names)
    for k in E9 + E10:
        assert f"{k}.zip" in names, k


@pytest.mark.skipif(not MP.is_dir(), reason="SeCMP 자산 미존재 — 통합 환경 전용")
def test_fixture_zips_match_secmp_assets():
    src = {z.name: z for z in MP.glob("*/*.zip")}
    missing = sorted(set(src) - {z.name for z in ZIP_DIR.glob("*.zip")})
    assert not missing, f"SeCMP 자산이 zip/ 에 없음: {missing}"
    differs = [n for n in src if (ZIP_DIR / n).exists() and _sha(ZIP_DIR / n) != _sha(src[n])]
    assert not differs, f"sha256 불일치: {differs}"


@pytest.mark.anyio
async def test_new_security_addons_install_from_fixtures(client, auth):
    for k in E9 + E10:
        z = ZIP_DIR / f"{k}.zip"
        r = await upload(client, auth, z.name, z.read_bytes(), force=True)
        assert r.status_code == 200, (k, r.status_code, r.text[:300])
    r = await client.get("/api/addon-agents/", headers=auth)
    keys = {a["agent_key"] for a in r.json()["addons"]}
    assert not [k for k in E9 + E10 if k not in keys]


@pytest.mark.anyio
async def test_e10_worker_guides_served(client, auth):
    for k in E10:
        r = await client.get(f"/api/addon-agents/{k}/worker-guide", headers=auth)
        assert r.status_code == 200, (k, r.text[:200])
        j = r.json()
        assert j["worker"]["required"] is True, j["worker"]
        assert j["guide"] and "Worker 설치 가이드" in j["guide"], (k, (j.get("guide") or "")[:80])


@pytest.mark.anyio
async def test_new_addons_status_graceful(client, auth):
    """외부 도구/worker 미기동 환경에서도 /status 는 200 또는 503(우아한 저하)."""
    for k in E9 + E10:
        r = await client.get(f"/api/addon/{k}/status", headers=auth)
        assert r.status_code in (200, 503), (k, r.status_code, r.text[:200])
