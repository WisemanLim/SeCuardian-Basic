"""Addon 매니페스트 v2 (`{Name}-meta.json`) 파싱·검증 — SeCuardian 방언 (PRD F5 / B-1.3).

세대별 meta.json 을 모두 수용한다:
- v0 (내장 배포본): key / type / name / min_platform_version / db_tables / dependencies(list)
- v1 (Template):    agent_type / version / display_name / description (+ description_en)
- v2 (Basic):       schema_version=2, agent_key, requires{}, dependencies{python}, tables_owned, worker, ...
레거시 alias 는 `_promote_legacy` 에서 승격되며, `normalize()` 결과는 항상 schema_version=2 이다.
display_name / description 은 문자열 또는 {"ko": …, "en": …} 다국어 dict 를 그대로 유지한다
(문자열→dict 변환은 저장 시점에 app.core.i18n.norm_descriptions 가 수행).

스키마 파일: addon-agents/manifest.schema.json (문서·외부 도구용). 런타임 검증은 이 pydantic 모델.
CLI: `uv run python -m app.services.addon_manifest <meta.json> [...]`
"""
import json
import re
import sys
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

AGENT_KEY_RE = re.compile(r"^[a-z][a-z0-9_-]{1,40}$")
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$")
AGENT_TYPES = {"app", "service", "tool-proxy", "rag", "reviewer", "execution", "hitl", "memory", "federation", "shell"}
WORKER_KINDS = {"external", "bundled"}

LangText = str | dict[str, str]


class AddonDependencies(BaseModel):
    model_config = ConfigDict(extra="allow")
    python: list[str] = Field(default_factory=list)   # PEP 508 스펙 문자열


class AddonRequires(BaseModel):
    model_config = ConfigDict(extra="allow")
    core: str = ""            # 예: ">=1.0.0"
    sdk: str = ""             # 예: ">=1.0.0"
    agents: list[str] = Field(default_factory=list)   # 선행 설치 필요 agent_key


class AddonWorker(BaseModel):
    model_config = ConfigDict(extra="allow")
    required: bool = False
    kind: str = "external"    # external | bundled
    name: str = ""
    version: str = ""
    package: str = ""         # bundled: worker zip 파일명 (addon-agents/zip/)
    guide: str = ""           # {Name}-worker-guide.md

    @field_validator("kind")
    @classmethod
    def _kind(cls, v: str) -> str:
        v = (v or "external").lower()
        return v if v in WORKER_KINDS else "external"


class AddonManifest(BaseModel):
    """v2 매니페스트. 알 수 없는 키(epic/layer/tags/endpoints/env_vars/notes …)는 extra 로 보존."""
    model_config = ConfigDict(extra="allow")

    schema_version: int = 1
    agent_key: str = ""
    display_name: LangText = ""
    description: LangText = ""
    description_en: str = ""          # 레거시 병행 키 (i18n.norm_descriptions 가 en 으로 병합)
    version: str = "1.0.0"
    agent_type: str = "app"
    categories: list[str] = Field(default_factory=list)
    has_front: bool | None = None     # None 이면 파일 존재 여부로 판단
    dependencies: AddonDependencies = Field(default_factory=AddonDependencies)
    requires: AddonRequires = Field(default_factory=AddonRequires)
    tables_owned: list[str] = Field(default_factory=list)
    permissions: list[str] = Field(default_factory=list)
    worker: AddonWorker | None = None
    required_env: list[str] = Field(default_factory=list)
    optional_env: list[str] = Field(default_factory=list)
    capabilities: list[dict[str, Any]] = Field(default_factory=list)
    governance: dict[str, Any] = Field(default_factory=dict)
    base_agent: dict[str, Any] | None = None
    publisher: str = ""
    license: str = ""

    # ── 레거시 alias 승격 ────────────────────────────────────────────────
    @model_validator(mode="before")
    @classmethod
    def _promote_legacy(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        d = dict(data)
        if not d.get("agent_key") and d.get("key"):
            d["agent_key"] = d.pop("key")
        else:
            d.pop("key", None)
        if not d.get("agent_type") and d.get("type"):
            d["agent_type"] = d.pop("type")
        else:
            d.pop("type", None)
        if not d.get("display_name") and d.get("name"):
            d["display_name"] = d["name"]
        d.pop("name", None)
        mpv = d.pop("min_platform_version", None)
        req = d.get("requires")
        req = dict(req) if isinstance(req, dict) else {}
        if mpv and not req.get("core"):
            req["core"] = f">={mpv}" if re.match(r"^\d", str(mpv)) else str(mpv)
        if req or "requires" in d:
            d["requires"] = req
        dbt = d.pop("db_tables", None)
        if isinstance(dbt, list) and not d.get("tables_owned"):
            d["tables_owned"] = [t for t in dbt if isinstance(t, str)]
        deps = d.get("dependencies")
        if isinstance(deps, list):
            d["dependencies"] = {"python": [x for x in deps if isinstance(x, str)]}
        elif deps is None or not isinstance(deps, dict):
            d.pop("dependencies", None)
        # 문자열 하나로 온 목록 필드 보정
        for k in ("categories", "tables_owned", "permissions", "required_env", "optional_env"):
            if isinstance(d.get(k), str):
                d[k] = [d[k]]
            elif k in d and not isinstance(d[k], list):
                d.pop(k)
        if "capabilities" in d:
            caps = d["capabilities"]
            # 레거시 태그형(["a2a", ...]) 은 capability 인덱스 대상이 아니므로 dict 항목만 유지
            d["capabilities"] = [c for c in caps if isinstance(c, dict)] if isinstance(caps, list) else []
        if "governance" in d and not isinstance(d["governance"], dict):
            d.pop("governance")
        if "worker" in d and not isinstance(d["worker"], dict):
            d.pop("worker")
        if "base_agent" in d and not isinstance(d["base_agent"], dict):
            d.pop("base_agent")
        if "has_front" in d and not isinstance(d["has_front"], bool):
            d.pop("has_front")
        return d

    @field_validator("schema_version", mode="before")
    @classmethod
    def _sv(cls, v: Any) -> int:
        try:
            return int(v)
        except (TypeError, ValueError):
            return 1

    @field_validator("agent_key")
    @classmethod
    def _key(cls, v: str) -> str:
        v = (v or "").strip()
        if v and not AGENT_KEY_RE.match(v):
            raise ValueError(f"agent_key 형식 오류: {v!r} (^[a-z][a-z0-9_-]{{1,40}}$)")
        return v

    @field_validator("version", mode="before")
    @classmethod
    def _ver(cls, v: Any) -> str:
        v = str(v or "").strip()
        if v and not SEMVER_RE.match(v):
            raise ValueError(f"version 은 semver 형식이어야 합니다: {v!r}")
        return v or "1.0.0"

    @field_validator("agent_type", mode="before")
    @classmethod
    def _type(cls, v: Any) -> str:
        v = str(v or "app").strip().lower()
        return v if v in AGENT_TYPES else "app"

    @field_validator("display_name", "description", mode="before")
    @classmethod
    def _lang(cls, v: Any) -> LangText:
        if isinstance(v, dict):
            return {k: s.strip() for k, s in v.items() if isinstance(s, str) and s.strip()}
        return str(v).strip() if isinstance(v, str) else ""

    # ── 파생 속성 ────────────────────────────────────────────────────────
    def text(self, field: str, lang: str = "ko") -> str:
        """display_name/description 을 단일 문자열로 (dict 면 lang → en → 첫 값)."""
        v = getattr(self, field)
        if isinstance(v, dict):
            return v.get(lang) or v.get("en") or next(iter(v.values()), "")
        return v or ""

    @property
    def isolation_required(self) -> bool:
        g = self.governance or {}
        extra = self.model_extra or {}
        return bool(g.get("isolation_required") or extra.get("isolation_required"))


class ManifestError(ValueError):
    pass


def load_manifest(path: Path | None) -> AddonManifest:
    """meta.json 파싱. 파일이 없으면 기본 매니페스트. 형식 오류는 ManifestError."""
    if path is None or not path.exists():
        return AddonManifest()
    return load_manifest_bytes(path.read_bytes())


def load_manifest_bytes(raw: bytes) -> AddonManifest:
    try:
        data = json.loads(raw.decode("utf-8-sig"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ManifestError(f"meta.json JSON 파싱 실패: {exc}") from exc
    if not isinstance(data, dict):
        raise ManifestError("meta.json 최상위는 객체여야 합니다")
    try:
        return AddonManifest.model_validate(data)
    except ValidationError as exc:
        first = exc.errors()[0]
        loc = ".".join(str(x) for x in first["loc"])
        raise ManifestError(f"meta.json 검증 실패: {loc} — {first['msg']}") from exc


def normalize(m: AddonManifest) -> dict:
    """저장용 정규화 dict — schema_version=2, alias 승격 반영, extra 키 보존, worker 는 None 이면 생략."""
    d = m.model_dump(exclude_none=True)
    d["schema_version"] = 2
    return d


def _ver_tuple(v: str) -> tuple[int, ...]:
    return tuple(int(x) for x in re.split(r"[.+-]", v)[:3] if x.isdigit())


def satisfies(spec: str, version: str) -> bool:
    """단순 버전 제약 평가: ">=1.0.0", ">1.2", "==1.0.0", "<2", "~=1.0" 콤마 조합. 형식 오류 → False."""
    if not spec or not spec.strip():
        return True
    cur = _ver_tuple(version)
    for part in [p.strip() for p in spec.split(",") if p.strip()]:
        m = re.match(r"^(>=|<=|==|!=|>|<|~=)?\s*v?([0-9][0-9A-Za-z.+-]*)$", part)
        if not m:
            return False
        op, ver = m.group(1) or "==", _ver_tuple(m.group(2))
        ok = {
            ">=": cur >= ver, "<=": cur <= ver, "==": cur == ver, "!=": cur != ver,
            ">": cur > ver, "<": cur < ver,
            "~=": cur >= ver and cur[: max(1, len(ver) - 1)] == ver[: max(1, len(ver) - 1)],
        }[op]
        if not ok:
            return False
    return True


def _main(argv: list[str]) -> int:
    """`python -m app.services.addon_manifest <meta.json>...` — 검증 결과를 출력하고 실패 시 1 반환."""
    if not argv:
        print("usage: python -m app.services.addon_manifest <meta.json> [...]", file=sys.stderr)
        return 2
    rc = 0
    for arg in argv:
        try:
            m = load_manifest_bytes(Path(arg).read_bytes())
        except (OSError, ManifestError) as exc:
            print(f"FAIL {arg}: {exc}")
            rc = 1
            continue
        n = normalize(m)
        legacy = " (legacy schema_version=%d → 2)" % m.schema_version if m.schema_version < 2 else ""
        print(f"OK   {arg}: agent_key={n['agent_key'] or '(zip stem)'} type={n['agent_type']} "
              f"version={n['version']}{legacy}")
    return rc


if __name__ == "__main__":  # pragma: no cover
    sys.exit(_main(sys.argv[1:]))
