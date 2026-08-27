"""E2 — 매니페스트 v2 파싱·레거시 alias 승격·13종 카탈로그 zip 호환 (F5/D13)."""
import json
import zipfile

import pytest

from util_addon import ROOT
from app.services.addon_manifest import (
    AGENT_KEY_RE, ManifestError, load_manifest_bytes, normalize, satisfies,
)


def _load(d: dict):
    return load_manifest_bytes(json.dumps(d).encode())


def test_legacy_key_type_aliases():
    m = _load({"key": "vasca-cve", "type": "service", "name": "VASCA",
               "min_platform_version": "1.0.0", "db_tables": ["tbl_x"],
               "dependencies": ["httpx"]})
    assert m.agent_key == "vasca-cve"          # key → agent_key (하이픈 허용)
    assert m.agent_type == "service"           # type → agent_type
    assert m.text("display_name") == "VASCA"   # name → display_name
    assert m.requires.core == ">=1.0.0"        # min_platform_version → requires.core
    assert m.tables_owned == ["tbl_x"]         # db_tables → tables_owned
    assert m.dependencies.python == ["httpx"]  # list → dependencies.python
    n = normalize(m)
    assert n["schema_version"] == 2 and "key" not in n and "type" not in n


def test_dict_display_name_and_description():
    m = _load({"display_name": {"ko": "게시판", "en": "Board"},
               "description": {"ko": "설명", "en": "desc", "jp": ""}})
    assert m.display_name == {"ko": "게시판", "en": "Board"}   # dict 유지
    assert m.description == {"ko": "설명", "en": "desc"}       # 빈 값 제거
    assert m.text("display_name") == "게시판" and m.text("display_name", "en") == "Board"


def test_agent_key_validation():
    assert AGENT_KEY_RE.match("teleport-pam") and AGENT_KEY_RE.match("t1") \
        and AGENT_KEY_RE.match("a_b-c")
    for bad in ("1abc", "Upper", "a", "a" * 42, "한글"):
        assert not AGENT_KEY_RE.match(bad)
    with pytest.raises(ManifestError):
        _load({"agent_key": "Invalid Key!"})
    with pytest.raises(ManifestError):
        _load({"version": "abc"})


def test_satisfies():
    assert satisfies(">=1.0.0", "1.0.0") and satisfies(">=1.0.0,<2", "1.5.0")
    assert not satisfies(">=2.0.0", "1.0.0")
    assert satisfies("", "1.0.0") and not satisfies("garbage", "1.0.0")


def test_worker_and_governance_passthrough():
    m = _load({"worker": {"required": True, "kind": "bundled", "package": "X_worker.zip"},
               "governance": {"isolation_required": True}, "epic": "E21", "layer": "L6"})
    assert m.worker.required and m.worker.kind == "bundled"
    assert m.isolation_required
    n = normalize(m)
    assert n["epic"] == "E21" and n["layer"] == "L6"  # 알 수 없는 키 보존


def test_marketplace_security_zips_load():
    """SeCMP marketplace-assets/security 의 보안 Addon 전량(21종) meta.json load_manifest_bytes OK.

    Basic 저장소는 Agent 를 동봉하지 않는다(순수 코어). 배포 자산은 SeCuardian-Marketplace 소관이며,
    형제 프로젝트가 없는 환경(CI 등)에서는 skip.
    """
    mp = ROOT.parent / "SeCuardian-Marketplace" / "marketplace-assets" / "security"
    if not mp.is_dir():
        pytest.skip("SeCuardian-Marketplace 자산 미존재 — 통합 환경 전용 검사")
    zips = sorted(mp.glob("*.zip"))
    agent_zips = [z for z in zips if not z.stem.endswith("_worker")]
    assert len(agent_zips) >= 13, [z.name for z in agent_zips]
    for z in agent_zips:
        with zipfile.ZipFile(z) as zf:
            raw = zf.read(f"{z.stem}-meta.json")
        m = load_manifest_bytes(raw)
        key = m.agent_key or z.stem.lower()
        assert AGENT_KEY_RE.match(key), (z.name, key)
        assert normalize(m)["schema_version"] == 2
