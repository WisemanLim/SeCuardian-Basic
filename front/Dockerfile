FROM node:22-slim AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* .npmrc* ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
# 기본(base) 이미지는 배포된 ADDON 에이전트 화면(front)을 번들에 포함하지 않는다.
# deployed/*.tsx 제거 → AddonAgentPage 의 import.meta.glob 이 빈 목록 → GenericAddonPage 폴백.
# ADDON 배포 시 web 재빌드로 활성화된다 (핫 디플로이 흐름).
ARG SKIP_DEPLOYED_ADDONS=false
RUN if [ "$SKIP_DEPLOYED_ADDONS" = "true" ]; then \
      rm -f src/pages/addon/deployed/*.tsx; \
      echo "[build] skipped pre-deployed addon fronts (src/pages/addon/deployed/*.tsx)"; \
    fi
ARG VITE_API_URL=http://localhost:8200
ENV VITE_API_URL=$VITE_API_URL
ENV CI=true
RUN node_modules/.bin/tsc --noEmit && node_modules/.bin/vite build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
