"""ShellAgent — 서버 상태 점검용 CLI/셸 진단 Agent.

마운트 경로: /api/addon/shellagent/...
엔드포인트:
  GET  /presets   진단용 프리셋 명령 목록
  POST /exec      허용된 명령 1건 실행 → stdout/stderr/exit code 반환

보안 원칙 (읽기 전용 진단 전용):
  - supervisor/admin 만 실행 가능 (require_role)
  - 실행 파일 allowlist — 첫 토큰(바이너리)이 허용 목록에 있어야 함
  - 셸 메타문자(; | & ` $ > < 개행 등) 포함 시 거부 → 명령 체이닝·인젝션 차단
  - shell=False + shlex 파싱으로 실행 (셸 해석 없음)
  - 타임아웃 15초, 출력 64KB 제한

docker.sock 이 컨테이너에 마운트되어 있어 `docker ps` 등 컨테이너 상태 점검이 가능합니다.
"""
import asyncio
import shlex

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.addon_sdk import require_role

router = APIRouter(tags=["shell-agent"])

# ─── 실행 정책 ────────────────────────────────────────────────────────────────

# 허용 바이너리 — 읽기 전용 진단 명령만. 필요 시 운영 정책에 맞춰 조정.
_ALLOWED = {
    "docker", "ps", "df", "free", "uptime", "uname", "whoami", "hostname",
    "id", "date", "ss", "netstat", "ip", "ifconfig", "top", "vmstat",
    "cat", "ls", "head", "tail", "wc", "env", "printenv", "du", "which", "echo",
}

# 셸 메타문자 — 명령 체이닝/리다이렉션/치환 차단
_FORBIDDEN_CHARS = set(";|&`$><\n\r")

_TIMEOUT_SEC = 15
_MAX_OUTPUT = 64 * 1024  # 64KB

# 프리셋 — 프론트 버튼용. 서버 상태 점검 대표 명령.
_PRESETS = [
    {"label": "Docker 컨테이너", "cmd": "docker ps --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}'"},
    {"label": "Docker 리소스",   "cmd": "docker stats --no-stream --format 'table {{.Name}}\\t{{.CPUPerc}}\\t{{.MemUsage}}'"},
    {"label": "디스크 사용량",    "cmd": "df -h"},
    {"label": "메모리",          "cmd": "free -m"},
    {"label": "가동 시간",        "cmd": "uptime"},
    {"label": "프로세스",         "cmd": "ps aux"},
]


class ExecRequest(BaseModel):
    command: str


def _validate(command: str) -> list[str]:
    """명령 검증 후 argv 리스트 반환. 위반 시 HTTPException(400)."""
    cmd = command.strip()
    if not cmd:
        raise HTTPException(status_code=400, detail="명령이 비어 있습니다.")
    if len(cmd) > 2000:
        raise HTTPException(status_code=400, detail="명령이 너무 깁니다 (최대 2000자).")
    if any(ch in _FORBIDDEN_CHARS for ch in cmd):
        raise HTTPException(
            status_code=400,
            detail="셸 메타문자(; | & ` $ > < 줄바꿈)는 허용되지 않습니다.",
        )
    try:
        argv = shlex.split(cmd)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"명령 구문 오류: {exc}")
    if not argv:
        raise HTTPException(status_code=400, detail="명령을 해석할 수 없습니다.")
    binary = argv[0].rsplit("/", 1)[-1]  # 경로 접두 제거
    if binary not in _ALLOWED:
        raise HTTPException(
            status_code=403,
            detail=f"'{binary}' 는 허용되지 않은 명령입니다. 허용: {', '.join(sorted(_ALLOWED))}",
        )
    return argv


@router.get("/presets")
async def list_presets(user: dict = Depends(require_role("supervisor", "admin"))):
    """진단용 프리셋 명령 목록 + 허용 바이너리."""
    return {"presets": _PRESETS, "allowed": sorted(_ALLOWED)}


@router.post("/exec")
async def exec_command(
    body: ExecRequest,
    user: dict = Depends(require_role("supervisor", "admin")),
):
    """허용된 진단 명령 1건 실행."""
    argv = _validate(body.command)
    try:
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=_TIMEOUT_SEC)
        except asyncio.TimeoutError:
            proc.kill()
            raise HTTPException(status_code=504, detail=f"명령 실행 시간 초과 ({_TIMEOUT_SEC}초).")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"명령을 찾을 수 없습니다: {argv[0]}")
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"실행 실패: {exc}")

    def _decode(raw: bytes) -> str:
        text = raw.decode("utf-8", errors="replace")
        if len(text) > _MAX_OUTPUT:
            return text[:_MAX_OUTPUT] + "\n… (출력 잘림)"
        return text

    return {
        "command": body.command.strip(),
        "exit_code": proc.returncode,
        "stdout": _decode(out),
        "stderr": _decode(err),
    }
