FROM docker:27-cli AS docker-cli

FROM python:3.12-slim
WORKDIR /app
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins /usr/local/lib/docker/cli-plugins
RUN pip install --no-cache-dir uv
COPY pyproject.toml uv.lock ./
# 프로젝트 자체는 설치/빌드하지 않는다(--no-install-project).
# 프로젝트 wheel 빌드는 build-system(hatchling) 을 PyPI 에서 받아와야 하는데,
# 인터넷 미연결(로컬/에어갭) 환경에서 startup 이 이 fetch 로 실패했다. (#1)
# 앱은 /app 소스에서 직접 import 하므로 패키지 설치가 불필요하다.
RUN uv sync --frozen --no-install-project
COPY . .
# 3rd-party 의존성만 재확인 (프로젝트 미설치 → hatchling 불필요)
RUN uv sync --frozen --no-install-project
# 배포된 ADDON 에이전트(addon-agents/deployed/)는 .dockerignore 로 build context 에서 제외 →
# 기본 이미지에 포함되지 않는다. 런타임에 compose bind mount 또는 업로드로 주입.
EXPOSE 8000
# --no-sync: 런타임에 uv 가 프로젝트를 재-resolve/빌드하지 않도록(오프라인 startup 보장).
# uvicorn 은 이미 venv 에 설치되어 있고 app 은 /app 소스에서 import 된다.
CMD ["sh", "-c", "uv run --no-sync uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
