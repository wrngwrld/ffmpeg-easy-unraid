# ==============================================================================
# Stage 1 — Build (TypeScript backend + Vite frontend)
# ==============================================================================
FROM node:20-slim AS builder

WORKDIR /build

RUN corepack enable && corepack prepare yarn@4.18.0 --activate

COPY backend/package.json backend/yarn.lock* backend/.yarnrc.yml* ./backend/
RUN cd backend && yarn install --immutable

COPY frontend/package.json frontend/yarn.lock* frontend/.yarnrc.yml* ./frontend/
RUN cd frontend && yarn install --immutable

COPY backend/ ./backend/
RUN cd backend && yarn build

COPY frontend/ ./frontend/
RUN cd frontend && yarn build

# ==============================================================================
# Stage 2 — Runtime (Ubuntu 24.04 + FFmpeg + Node 20)
# ==============================================================================
FROM ubuntu:24.04

LABEL maintainer="metronade"
LABEL description="Transcode Harbor v2 — TypeScript + Vue 3"

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ffmpeg libva-drm2 libva-x11-2 vainfo pciutils curl ca-certificates && \
    if ! apt-get install -y --no-install-recommends intel-media-va-driver-non-free 2>/dev/null; then \
      apt-get install -y --no-install-recommends intel-media-va-driver 2>/dev/null || true; \
    fi && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

ENV NVIDIA_VISIBLE_DEVICES=all
ENV NVIDIA_DRIVER_CAPABILITIES=compute,video,utility

WORKDIR /opt/transcode-harbor

COPY --from=builder /build/backend/dist         ./backend/dist
COPY --from=builder /build/backend/node_modules ./backend/node_modules
COPY --from=builder /build/frontend/dist        ./web

ENV STATIC_ROOT=/opt/transcode-harbor/web
ENV MEDIA_DIR=/media
ENV EXPORT_DIR=/export
ENV CONFIG_DIR=/config
ENV ADMIN_PORT=8080
ENV NODE_ENV=production

EXPOSE 8080
ENTRYPOINT ["node", "backend/dist/index.js"]
