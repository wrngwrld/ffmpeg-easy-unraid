# Transcode Harbor

<div align="center">
  <img src="./icon.png" width="150" height="150" alt="Transcode Harbor logo">
</div>

Transcode Harbor is a Docker-first media transcoding app for Unraid and homelab setups.
It provides a Vue 3 web UI to browse your library, queue jobs, monitor progress in real time, compare source vs output, and store historical savings data.

## What It Is

This repository contains a full-stack app:

- Backend: Fastify + TypeScript API that controls FFmpeg
- Frontend: Vue 3 + TypeScript + Tailwind dashboard
- Runtime: Docker image with FFmpeg, Node.js, and optional hardware acceleration

Important: this is queue-driven and UI-driven. It does not auto-scan folders on startup and does not move originals to a finished folder.

## Core Features

- Interactive media browser rooted at `/media`
- Queue-based workflow with cancel support
- Queue one file or queue an entire folder recursively
- Parallel workers (`PARALLEL_JOBS`)
- Hardware probing with fallback:
  - Linux: VAAPI (`hevc_vaapi`)
  - macOS: VideoToolbox (`hevc_videotoolbox`)
  - Fallback: software (`libx265`)
- H.265 output in MKV container
- Audio/subtitle stream copy (`-c:a copy -c:s copy`)
- Real-time progress updates via Server-Sent Events (SSE)
- History and aggregate savings persisted in `/config/stats.json`
- Source/output preview streaming for side-by-side comparison

## Supported Media Inputs

- `.mkv`
- `.mp4`
- `.ts`
- `.m2ts`
- `.avi`
- `.mov`
- `.wmv`

## Quick Start (Docker Compose)

1. Edit [docker-compose.yml](docker-compose.yml) to match your paths.
2. Start the stack:

```bash
docker compose up --build -d
```

3. Open the UI:

```text
http://localhost:8080
```

Current compose defaults:

- `/media` mounted read-only (source library)
- `/export` mounted read-write (transcode outputs)
- `/config` mounted read-write (history state)

## Hardware Acceleration Notes

On Linux/Unraid, enable Intel QuickSync/Arc by passing through `/dev/dri`:

```yaml
devices:
  - /dev/dri:/dev/dri
```

On startup, the backend probes available hardware encoders. If none are available, jobs still run with `libx265`.

## Environment Variables

| Variable        | Default                                  | Description                                                         |
| --------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| `MEDIA_DIR`     | `/media`                                 | Root input directory exposed in the browser/API.                    |
| `EXPORT_DIR`    | `/export`                                | Output root for transcoded files.                                   |
| `CONFIG_DIR`    | `/config`                                | Persistent app state (history stats).                               |
| `ADMIN_PORT`    | `8080`                                   | HTTP port used by backend and served frontend.                      |
| `PARALLEL_JOBS` | `1`                                      | Max concurrent transcode jobs. Minimum is 1.                        |
| `STATIC_ROOT`   | auto                                     | Frontend assets path. In Docker: `/opt/transcode-harbor/web`.       |
| `UNRAID_UID`    | `99` (image) / `1000` (compose example)  | Reserved for compatibility; currently not enforced by runtime code. |
| `UNRAID_GID`    | `100` (image) / `1000` (compose example) | Reserved for compatibility; currently not enforced by runtime code. |

## API Overview

- `GET /api/fs?path=/...` list folders/files from media root
- `POST /api/transcode` queue one file
- `POST /api/transcode/folder` queue all supported files in a folder recursively
- `GET /api/jobs` list queue and hardware encoder state
- `DELETE /api/jobs/:id` cancel queued/running job
- `GET /api/events` SSE stream for live status/progress
- `GET /api/history` read recent entries + totals
- `GET /api/stream/source?path=...` byte-range stream from media
- `GET /api/stream/output?path=...` byte-range stream from export

## Transcode Behavior

- Output path mirrors source relative path with `.mkv` extension.
- Encoder behavior:
  - VAAPI path: `hevc_vaapi`
  - VideoToolbox path: `hevc_videotoolbox`
  - Software path: `libx265`
- Default mapping keeps all streams: `-map 0`
- Audio and subtitles are copied by default.

## Local Development

Requirements:

- Node.js 20+
- FFmpeg and ffprobe on your PATH
- Yarn 4.18+ (recommended)

Install dependencies (recommended):

```bash
cd backend && yarn install
cd ../frontend && yarn install
```

Run full-stack hot reload from the repository root:

```bash
yarn dev
```

Default `yarn dev` behavior:

- Frontend: HMR enabled
- Backend: stable process (no auto-restart)
- If `BACKEND_PORT` is already in use, the dev runner reuses that existing backend instead of crashing.

Use full hot mode only when editing backend code and no long transcodes are running:

```bash
yarn dev:hot
```

Default dev ports:

- Backend API: `http://localhost:8081`
- Frontend (Vite): `http://localhost:5173`
- Frontend proxies `/api/*` to backend automatically

Default dev paths (auto-created if missing):

- `MEDIA_DIR=./media`
- `EXPORT_DIR=./export`
- `CONFIG_DIR=./config`

Optional overrides:

```bash
BACKEND_PORT=9090 FRONTEND_PORT=5174 yarn dev
```

Run services individually if needed:

```bash
yarn dev:backend
yarn dev:backend:watch
yarn dev:frontend
```

Build both apps from the repository root:

```bash
yarn build
```

Docker builds use Corepack + Yarn 4 inside the container, so Yarn is the canonical lockfile source.

Run backend dev server manually:

```bash
cd backend
yarn dev
```

Run frontend dev server manually (second terminal):

```bash
cd frontend
yarn dev
```

Build frontend:

```bash
cd frontend
yarn build
```

## Production Build

Build image:

```bash
docker build -t transcode-harbor:latest .
```

Run container:

```bash
docker run --rm \
  -p 8080:8080 \
  -e MEDIA_DIR=/media \
  -e EXPORT_DIR=/export \
  -e CONFIG_DIR=/config \
  -e PARALLEL_JOBS=1 \
  -v /path/to/media:/media:ro \
  -v /path/to/export:/export \
  -v /path/to/config:/config \
  transcode-harbor:latest
```

## Project Structure

- [backend](backend): Fastify API, queue, FFmpeg integration
- [frontend](frontend): Vue app and Tailwind UI
- [config](config): local bind target for persisted history
- [media](media): local bind target for source media
- [export](export): local bind target for outputs

## Troubleshooting

- Hardware encoder not available:
  - Linux: confirm `/dev/dri` mapping and host VAAPI support (`vainfo`).
  - macOS: ensure FFmpeg build includes VideoToolbox.
  - Check backend logs for fallback messages.
- Output not visible:
  - Verify `EXPORT_DIR` and volume mappings.
  - Confirm source file extension is supported.
- UI loads but no events:
  - Ensure reverse proxies do not buffer SSE on `/api/events`.
- Compare player fails in Chrome for MKV/HEVC:
  - The app now auto-switches to a browser-compatible preview mode (`/api/stream/preview/*`) that generates cached H.264/AAC MP4 files.
  - First load can take longer while preview files are generated.
  - Preview cache is stored under `/config/preview-cache`.

## License

GPL-3.0. See [LICENSE](LICENSE).
