# ==============================================================================
# Dockerfile: FFmpeg-Easy-Unraid
# Project:    Simple H265 and AV1 Batch Transcoder
# Author:     metronade
# Base:       Ubuntu 24.04 (Includes FFmpeg 6.1 native)
# ==============================================================================

FROM ubuntu:24.04

# Metadata
LABEL maintainer="metronade"
LABEL description="Simple H265 and AV1 Batch Transcoder"

ENV DEBIAN_FRONTEND=noninteractive

# --- CONFIG DEFAULTS ---
ENV ENCODE_METHOD=intel_h265
ENV ENCODE_QP=22
ENV ADMIN_PORT=8080

# Custom Arguments
ENV FFMPEG_CUSTOM_ARGS=""

# Unraid Permissions
ENV UNRAID_UID=99
ENV UNRAID_GID=100

# --- NVIDIA RUNTIME SUPPORT ---
# These variables tell the Nvidia Container Runtime to inject libraries automatically
ENV NVIDIA_VISIBLE_DEVICES=all
ENV NVIDIA_DRIVER_CAPABILITIES=compute,video,utility

# 1. Install Dependencies & FFmpeg & Drivers
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    libva-drm2 \
    libva-x11-2 \
    vainfo \
    pciutils \
    inotify-tools \
    bc \
    curl \
    wget && \
    if ! apt-get install -y --no-install-recommends intel-media-va-driver; then echo "[WARN] intel-media-va-driver unavailable on this architecture; skipping"; fi && \
    if ! apt-get install -y --no-install-recommends i965-va-driver; then echo "[WARN] i965-va-driver unavailable on this architecture; skipping"; fi && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Root directories for simplified access
WORKDIR /

COPY admin_server.py /opt/ffmpeg-easy/admin_server.py
COPY web /opt/ffmpeg-easy/web
COPY start.sh /usr/local/bin/start.sh
COPY transcode.sh /usr/local/bin/transcode.sh
RUN chmod +x /usr/local/bin/transcode.sh /usr/local/bin/start.sh

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/start.sh"]
