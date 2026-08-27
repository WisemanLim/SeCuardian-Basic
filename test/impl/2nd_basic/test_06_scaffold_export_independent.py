"""F19 — 스캐폴드/Export ZIP 무의존(독립 설치) 보장 시험. 시나리오: scenario.md"""
import io
import json
import re
import zipfile

import pytest

_TYPES = ["app", "service", "tool-proxy", "rag", "reviewer",
          "execution", "hitl", "memory", "federation", "shell"]
_ALLOWED = ("app.addon_sdk", "app.core.deps", "app.db")
_IMP = re.compile(r"^\s*(?:from|import)\s+(app(?:\.[\w.]+)?)\b", re.MULTILINE)


def _zip_parts(data: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        return {n: zf.read(n) for n in zf.namelist()}


def _assert_independent(name: str, parts: dict[str, bytes]):
    meta = json.loads(parts[f"{name}-meta.json"])
    assert meta["agent_key"] == name.lower(), meta["agent_key"]      # 키 정합 (결함 B2)
    assert meta["requires"]["agents"] == []                           # 선행 Agent 없음
    assert meta["schema_version"] == 2
    app_py = parts.get(f"{name}-app.py", b"").decode()
    for m in _IMP.finditer(app_py):
        mod = m.group(1)
        assert any(mod == a or mod.startswith(a + ".") for a in _ALLOWED), mod


@pytest.mark.anyio
@pytest.mark.parametrize("agent_type", _TYPES)
async def test_scaffold_all_types_independent(client, auth, agent_type):
    """10개 유형 전부 스캐폴드 생성 성공(결함 B1: shell 404) + 무의존 + 설치 성공."""
    name = "Sc" + agent_type.replace("-", "")
    r = await client.post("/api/addon-agents/scaffold",
                          json={"agent_name": name, "agent_type": agent_type,
                                "description": "scaffold independence test"},
                          headers=auth)
    assert r.status_code == 200, (agent_type, r.status_code, r.text[:200])
    parts = _zip_parts(r.content)
    _assert_independent(name, parts)
    meta = json.loads(parts[f"{name}-meta.json"])
    assert meta["dependencies"]["python"] == []                       # scaffold 는 pip 의존 0
    up = await client.post("/api/addon-agents/upload", data={"force": "true"},
                           files={"file": (f"{name}.zip", r.content, "application/zip")},
                           headers=auth)
    assert up.status_code == 200, (agent_type, up.text[:300])


@pytest.mark.anyio
async def test_scaffold_mcp_proxy_independent(client, auth):
    r = await client.post("/api/addon-agents/scaffold",
                          json={"agent_name": "ScProxy", "agent_type": "tool-proxy",
                                "enable_mcp_proxy": True,
                                "upstream_base_url": "http://up.example:9",
                                "openapi_url": "http://up.example:9/openapi.json"},
                          headers=auth)
    assert r.status_code == 200, r.text[:200]
    _assert_independent("ScProxy", _zip_parts(r.content))


@pytest.mark.anyio
async def test_export_roundtrip_independent(client, auth):
    """설치본(scapp) export → 새 키 정합·출처 표기·requires 비움·재설치 성공."""
    r = await client.post("/api/addon-agents/scapp/export",
                          json={"new_name": "ScDerived", "description": "derived"},
                          headers=auth)
    assert r.status_code == 200, r.text[:300]
    parts = _zip_parts(r.content)
    _assert_independent("ScDerived", parts)
    meta = json.loads(parts["ScDerived-meta.json"])
    assert meta["base_agent"]["agent_key"] == "scapp"
    up = await client.post("/api/addon-agents/upload", data={"force": "true"},
                           files={"file": ("ScDerived.zip", r.content, "application/zip")},
                           headers=auth)
    assert up.status_code == 200, up.text[:300]
