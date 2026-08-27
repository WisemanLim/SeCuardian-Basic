"""Addon ZIP 등록 검증 파이프라인 (PRD F8 / D12 — MAS-Basic addon_validator 이식).

마켓플레이스(SeCMP)는 제3자가 만든 에이전트를 유통하므로, 설치 시점에 정적 검증을 거친다.

kind 정책:
  - "addon"  (기본): 확장자 화이트리스트 + Python AST 검사. CRITICAL 1건 이상 → 설치 차단.
  - "worker": 대상 디바이스에 직접 설치하는 worker 배포 패키지(`*_worker.zip`, manifest worker.kind=bundled).
              바이너리·.go/.cpp/.hpp/Dockerfile/Makefile/bin/ 허용, 한도 완화. Python 코드 검출은 WARNING 으로 기록.
              (플랫폼이 실행하지 않고 다운로드 전용으로 배포하므로 — R22-4)

검증 항목:
  1. ZIP 구조 — 경로 탐색(`..`/절대경로), 심볼릭 링크, 항목 수·압축해제 크기(zip bomb)
  2. 파일 종류 — 확장자 화이트리스트
  3. Python 코드 — AST 기반 위험 import·호출 탐지

판정: CRITICAL 1건 이상 → 등록 차단. WARNING 만 있으면 등록 허용 + 리포트 기록.
정적 분석은 우회 가능하므로(getattr 조합·문자열 난독화 등) 런타임 샌드박스를 대체하지 않는다.
"""
import ast
import zipfile
from dataclasses import dataclass, field

# ── 한도 (zip bomb·자원 소모 방지) ─────────────────────────────
MAX_ENTRIES = 200               # ZIP 내 항목 수
MAX_UNCOMPRESSED = 50 * 1024 * 1024   # 압축 해제 총 크기 50MB
MAX_COMPRESSION_RATIO = 100     # 개별 항목 압축률 (해제/압축)
WORKER_MAX_ENTRIES = 2000
WORKER_MAX_UNCOMPRESSED = 300 * 1024 * 1024

KIND_ADDON = "addon"
KIND_WORKER = "worker"

# ── 파일 종류 화이트리스트 ────────────────────────────────────
ALLOWED_SUFFIXES = {
    ".py", ".tsx", ".ts", ".jsx", ".js", ".sql", ".json",
    ".md", ".txt", ".css", ".yaml", ".yml", ".svg", ".png", ".jpg", ".jpeg",
    # 데이터 애드온(모델·샘플) 허용 — data/ 하위 배치 권장
    ".pkl", ".joblib", ".csv", ".xlsx", ".pdf", ".bin", ".onnx",
}
# worker 패키지 추가 허용 (소스·빌드 스크립트·컨테이너 정의)
WORKER_EXTRA_SUFFIXES = {
    ".go", ".mod", ".sum", ".c", ".cc", ".cpp", ".h", ".hpp", ".rs", ".toml", ".lock",
    ".sh", ".service", ".conf", ".ini", ".env", ".cfg", ".xml", ".proto", ".gitignore",
    ".so", ".dylib", ".dll", ".exe", ".a", ".tar", ".gz", ".whl",
}
WORKER_ALLOWED_BASENAMES = {"dockerfile", "makefile", "cmakelists.txt", "version", "license", "readme", "notice"}

# ── 위험 모듈 ────────────────────────────────────────────────
CRITICAL_MODULES = {
    "subprocess", "socket", "ctypes", "pty", "marshal",
    "multiprocessing", "importlib", "builtins", "_thread", "resource",
    "telnetlib", "ftplib", "paramiko",
}
# MAS-Basic: pickle(ML 모델 로드)·smtplib(알림 메일)은 WARNING 으로 완화 — scan_result 에 기록되어 운영자가 검토
WARNING_MODULES = {
    "os", "sys", "shutil", "pathlib", "tempfile", "glob",
    "requests", "httpx", "urllib", "aiohttp", "http", "pickle", "smtplib",
}

# ── 위험 호출 (dotted name) ──────────────────────────────────
CRITICAL_CALLS = {
    "eval", "exec", "compile", "__import__", "globals", "locals",
    "os.system", "os.popen", "os.remove", "os.unlink", "os.rmdir",
    "os.execv", "os.execve", "os.execl", "os.spawnv", "os.fork", "os.kill",
    "os.chmod", "os.chown", "os.setuid", "os.setgid",
    "shutil.rmtree", "shutil.chown",
    "pickle.loads", "marshal.loads",
    "subprocess.run", "subprocess.Popen", "subprocess.call",
    "subprocess.check_output", "subprocess.check_call", "subprocess.getoutput",
}
WARNING_CALLS = {
    "setattr", "delattr", "getattr", "vars",
    "pickle.load", "shutil.move",
    "os.getenv", "os.environ", "os.putenv",
    "requests.get", "requests.post", "httpx.get", "httpx.post",
    "urllib.request.urlopen",
}

SEVERITY_CRITICAL = "CRITICAL"
SEVERITY_WARNING = "WARNING"


@dataclass
class Finding:
    severity: str
    rule: str
    detail: str
    location: str = ""

    def as_dict(self) -> dict:
        return {
            "severity": self.severity,
            "rule": self.rule,
            "detail": self.detail,
            "location": self.location,
        }


@dataclass
class ScanReport:
    findings: list[Finding] = field(default_factory=list)

    @property
    def critical(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == SEVERITY_CRITICAL]

    @property
    def warnings(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == SEVERITY_WARNING]

    @property
    def blocked(self) -> bool:
        return bool(self.critical)

    def add(self, severity: str, rule: str, detail: str, location: str = "") -> None:
        self.findings.append(Finding(severity, rule, detail, location))

    def as_dict(self) -> dict:
        return {
            "blocked": self.blocked,
            "critical_count": len(self.critical),
            "warning_count": len(self.warnings),
            "findings": [f.as_dict() for f in self.findings],
        }

    def summary(self) -> str:
        if self.blocked:
            head = self.critical[0]
            more = f" (외 {len(self.critical) - 1}건)" if len(self.critical) > 1 else ""
            return f"{head.rule}: {head.detail} [{head.location}]{more}"
        return f"CRITICAL 0건 / WARNING {len(self.warnings)}건"


def _dotted_name(node: ast.AST) -> str:
    """ast.Attribute/Name 체인을 'os.path.join' 형태 문자열로 복원."""
    parts: list[str] = []
    cur = node
    while isinstance(cur, ast.Attribute):
        parts.append(cur.attr)
        cur = cur.value
    if isinstance(cur, ast.Name):
        parts.append(cur.id)
    return ".".join(reversed(parts))


def _scan_python_source(source: str, filename: str, report: ScanReport) -> None:
    """Python 소스 AST 검사 — 위험 import·호출 탐지."""
    try:
        tree = ast.parse(source, filename=filename)
    except SyntaxError as exc:
        report.add(
            SEVERITY_CRITICAL, "syntax-error",
            f"Python 문법 오류로 검증 불가: {exc.msg}",
            f"{filename}:{exc.lineno or 0}",
        )
        return

    for node in ast.walk(tree):
        loc = f"{filename}:{getattr(node, 'lineno', 0)}"

        # import X / from X import ...
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if root in CRITICAL_MODULES:
                    report.add(SEVERITY_CRITICAL, "dangerous-import",
                               f"위험 모듈 import: {alias.name}", loc)
                elif root in WARNING_MODULES:
                    report.add(SEVERITY_WARNING, "sensitive-import",
                               f"민감 모듈 import: {alias.name}", loc)
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".")[0]
            if root in CRITICAL_MODULES:
                report.add(SEVERITY_CRITICAL, "dangerous-import",
                           f"위험 모듈 import: {node.module}", loc)
            elif root in WARNING_MODULES:
                report.add(SEVERITY_WARNING, "sensitive-import",
                           f"민감 모듈 import: {node.module}", loc)

        # 호출
        elif isinstance(node, ast.Call):
            name = _dotted_name(node.func)
            if not name:
                continue
            if name in CRITICAL_CALLS:
                report.add(SEVERITY_CRITICAL, "dangerous-call",
                           f"위험 호출: {name}()", loc)
            elif name in WARNING_CALLS:
                report.add(SEVERITY_WARNING, "sensitive-call",
                           f"민감 호출: {name}()", loc)
            elif name == "open":
                mode = ""
                for kw in node.keywords:
                    if kw.arg == "mode" and isinstance(kw.value, ast.Constant):
                        mode = str(kw.value.value)
                if not mode and len(node.args) >= 2 and isinstance(node.args[1], ast.Constant):
                    mode = str(node.args[1].value)
                if any(ch in mode for ch in ("w", "a", "x", "+")):
                    report.add(SEVERITY_WARNING, "file-write",
                               f"파일 쓰기 모드 open(mode={mode!r})", loc)

        # 이름 참조로 우회하는 형태 (eval 변수 대입 등)
        elif isinstance(node, ast.Name) and node.id in ("__builtins__", "__loader__"):
            report.add(SEVERITY_CRITICAL, "internal-access",
                       f"인터프리터 내부 접근: {node.id}", loc)


def _worker_allowed(name: str, suffix: str) -> bool:
    if suffix in ALLOWED_SUFFIXES or suffix in WORKER_EXTRA_SUFFIXES:
        return True
    base = name.rsplit("/", 1)[-1].lower()
    if base in WORKER_ALLOWED_BASENAMES or base.split(".")[0] in WORKER_ALLOWED_BASENAMES:
        return True
    # 확장자 없는 파일(빌드된 바이너리 등)은 bin/ 이하에서만 허용
    return suffix == "" and "/bin/" in f"/{name}"


def is_worker_package(zip_stem: str, manifest=None) -> bool:
    """worker 정책 적용 대상 판정 — 파일명 stem 이 `_worker` 로 끝나거나 manifest worker.kind=bundled 인 worker 패키지."""
    if zip_stem.lower().endswith("_worker"):
        return True
    worker = getattr(manifest, "worker", None) if manifest is not None else None
    if worker is not None and getattr(worker, "kind", "") == "bundled":
        pkg = (getattr(worker, "package", "") or "").lower()
        return pkg.startswith(zip_stem.lower())
    return False


def scan_zip(zf: zipfile.ZipFile, kind: str = KIND_ADDON) -> ScanReport:
    """ZIP 구조 + 파일 종류 + Python 코드 정적 검증. kind="worker" 면 바이너리 허용 정책."""
    report = ScanReport()
    infos = zf.infolist()
    worker = kind == KIND_WORKER
    max_entries = WORKER_MAX_ENTRIES if worker else MAX_ENTRIES
    max_uncompressed = WORKER_MAX_UNCOMPRESSED if worker else MAX_UNCOMPRESSED

    if len(infos) > max_entries:
        report.add(SEVERITY_CRITICAL, "too-many-entries",
                   f"ZIP 항목 수 초과: {len(infos)} > {max_entries}")

    total_uncompressed = 0
    for info in infos:
        name = info.filename

        # 경로 탐색
        if ".." in name or name.startswith("/") or name.startswith("\\"):
            report.add(SEVERITY_CRITICAL, "path-traversal",
                       f"안전하지 않은 경로: {name}")
            continue

        if info.is_dir():
            continue

        # 심볼릭 링크 (external_attr 상위 16비트의 파일 모드)
        if (info.external_attr >> 16) & 0o170000 == 0o120000:
            report.add(SEVERITY_CRITICAL, "symlink",
                       f"심볼릭 링크 항목: {name}")
            continue

        total_uncompressed += info.file_size
        if info.compress_size > 0:
            ratio = info.file_size / info.compress_size
            if ratio > MAX_COMPRESSION_RATIO and info.file_size > 1024 * 1024:
                report.add(SEVERITY_CRITICAL, "zip-bomb",
                           f"비정상 압축률 {ratio:.0f}배: {name}")

        # 확장자 화이트리스트
        base = name.rsplit("/", 1)[-1]
        suffix = ("." + base.rsplit(".", 1)[-1].lower()) if "." in base else ""
        if worker:
            if not _worker_allowed(name, suffix):
                report.add(SEVERITY_CRITICAL, "disallowed-file-type",
                           f"worker 패키지에 허용되지 않은 파일 종류: {name}")
                continue
        elif suffix not in ALLOWED_SUFFIXES:
            report.add(SEVERITY_CRITICAL, "disallowed-file-type",
                       f"허용되지 않은 파일 종류: {name}")
            continue

        # Python 코드 검사 (worker 는 플랫폼이 실행하지 않으므로 WARNING 으로 완화)
        if suffix == ".py":
            try:
                source = zf.read(info).decode("utf-8", errors="replace")
            except Exception as exc:  # noqa: BLE001
                report.add(SEVERITY_CRITICAL, "unreadable-file",
                           f"파일 읽기 실패: {name} ({exc})")
                continue
            if worker:
                sub = ScanReport()
                _scan_python_source(source, name, sub)
                for f in sub.findings:
                    report.add(SEVERITY_WARNING, f.rule, f.detail, f.location)
            else:
                _scan_python_source(source, name, report)

    if total_uncompressed > max_uncompressed:
        report.add(SEVERITY_CRITICAL, "uncompressed-size",
                   f"압축 해제 크기 초과: {total_uncompressed // (1024 * 1024)}MB > "
                   f"{max_uncompressed // (1024 * 1024)}MB")

    return report
