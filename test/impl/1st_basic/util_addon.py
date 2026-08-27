"""1st_basic 공용 헬퍼 — 경로·ZIP 생성·업로드."""
import io
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def make_zip(name: str, files: dict[str, str | bytes]) -> tuple[str, bytes]:
    """메모리 ZIP 생성 → (filename, bytes)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for fname, content in files.items():
            zf.writestr(fname, content if isinstance(content, bytes) else content.encode("utf-8"))
    return f"{name}.zip", buf.getvalue()


async def upload(client, auth, filename: str, data: bytes, force: bool = False):
    return await client.post(
        "/api/addon-agents/upload",
        data={"force": str(force).lower()},
        files={"file": (filename, data, "application/zip")},
        headers=auth,
    )
