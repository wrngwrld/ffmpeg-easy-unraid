# Plan: Full Rewrite — TypeScript Backend + Vue 3 Frontend + File Browser + Video Comparison

## TL;DR

Replace the bash+Python stack with a Node.js/TypeScript always-on backend (Fastify) and a Vite-built Vue 3 TypeScript frontend. Docker maps `/media` (read-only) instead of `/import`. Users browse the media tree in the UI, pick files, choose QP, and submit jobs. The backend manages an FFmpeg worker pool, streams progress via SSE, and serves source/output video for a synced side-by-side comparison player. Multi-stage Dockerfile builds everything inside Docker.

---

## Decisions (from user)

- VAAPI + libx265 software fallback
- Video streaming via HTTP range requests through the backend
- Multi-stage Dockerfile (Node build stage → Ubuntu runtime)
- `restart: always` (always-on server, no watch loop)

---

## New directory layout

```
ffmpeg-easy-unraid/
├── Dockerfile              (2-stage: node build → ubuntu+ffmpeg+node runtime)
├── docker-compose.yml
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts          Fastify bootstrap, routes, static serve
│       ├── config.ts         env parsing, typed constants, paths
│       ├── routes/
│       │   ├── fs.ts         GET /api/fs?path=
│       │   ├── transcode.ts  POST /api/transcode, GET /api/jobs, DELETE /api/jobs/:id
│       │   ├── stream.ts     GET /api/stream/source, /api/stream/output (HTTP 206)
│       │   ├── history.ts    GET /api/history
│       │   ├── rules.ts      GET/POST /api/rules
│       │   └── events.ts     GET /api/events (SSE)
│       └── services/
│           ├── ffmpeg.ts     HDR detect, VAAPI/SW command builder, progress parser
│           ├── jobQueue.ts   in-memory queue, worker pool, SSE broadcast
│           └── stats.ts      read/write /config/stats.json (atomic)
└── frontend/
    ├── package.json
    ├── vite.config.ts
    ├── tsconfig.json
    ├── index.html
    └── src/
        ├── main.ts
        ├── App.vue
        ├── router/index.ts
        ├── stores/
        │   ├── status.ts     SSE listener → reactive system state
        │   └── queue.ts      active jobs
        ├── views/
        │   ├── BrowseView.vue      file picker + transcode dialog
        │   ├── QueueView.vue       live job cards
        │   ├── HistoryView.vue     history list + comparison launch
        │   └── SystemView.vue      rules, settings
        └── components/
            ├── FileBrowser.vue     recursive tree, multi-select
            ├── TranscodeDialog.vue QP slider + encoder select + submit
            ├── JobCard.vue         progress bar + cancel button
            └── VideoCompare.vue    synced dual-player, split-screen slider
```

**Deleted files:** `transcode.sh`, `admin_server.py`, `start.sh`, `web/` (all)

---

## New volume mapping

| Container path | Host                      | Access     |
| -------------- | ------------------------- | ---------- |
| `/media`       | user's full media library | read-only  |
| `/export`      | transcoded output         | read-write |
| `/config`      | rules.json, stats.json    | read-write |

Old `/import` and `/export/.ffmpeg-easy-admin/` are gone.

---

## API surface

| Method | Path                        | Description                                                   |
| ------ | --------------------------- | ------------------------------------------------------------- |
| GET    | `/api/fs?path=/`            | List directory entries under `/media`                         |
| POST   | `/api/transcode`            | Queue a job `{ sourcePath, qp, encoder? }`                    |
| GET    | `/api/jobs`                 | All jobs (queued, running, done, failed)                      |
| DELETE | `/api/jobs/:id`             | Cancel a running or queued job                                |
| GET    | `/api/events`               | SSE stream: `job-added`, `job-progress`, `job-done`, `status` |
| GET    | `/api/stream/source?path=`  | HTTP 206 stream from `/media`                                 |
| GET    | `/api/stream/output?path=`  | HTTP 206 stream from `/export`                                |
| GET    | `/api/history?limit&offset` | Paginated history from stats.json                             |
| GET    | `/api/rules`                | Read rules                                                    |
| POST   | `/api/rules`                | Write rules (sanitized)                                       |

Path traversal protection: resolve + check prefix against allowed root before any read.

---

## Key service behaviours

### ffmpeg.ts

- On startup: probe hardware by running a 1-frame VAAPI encode; set `hardwareAvailable: boolean` flag
- `buildCommand(job)`: if VAAPI available → `hevc_vaapi` pipeline; else → `libx265 -preset medium`
- `detectHdr(path)`: ffprobe `color_transfer/primaries/colorspace/range`
- Progress parsing: `-progress pipe:1` → read stdout lines for `out_time_ms`, `speed`, `total_size`

### jobQueue.ts

- `maxWorkers` from `PARALLEL_JOBS` env (default 1)
- `start(job)`: spawns ffmpeg, attaches stdout reader, emits SSE `job-progress` on each progress tick
- On finish/fail: calls `stats.recordEntry(job)`, emits `job-done`/`job-failed`, drains next job

### stats.ts

- Atomic write: write to `.tmp` then `fs.rename`
- Keeps last 5000 entries in `recentFiles`
- Accumulates totals

### VideoCompare.vue

- Two `<video>` refs; `currentTime` sync via `timeupdate` + `seeking` events
- `play`/`pause`/`rate` bridged bidirectionally
- Draggable vertical divider for "overlay split" mode
- Sources: `/api/stream/source?path=...` and `/api/stream/output?path=...`

---

## Phased steps

### Phase 1 — Backend (can be implemented in parallel for independent files)

1. `backend/package.json` + `backend/tsconfig.json`
2. `backend/src/config.ts`
3. `backend/src/services/ffmpeg.ts` (depends on config)
4. `backend/src/services/stats.ts` (depends on config)
5. `backend/src/services/jobQueue.ts` (depends on ffmpeg, stats)
6. `backend/src/routes/fs.ts` (depends on config)
7. `backend/src/routes/transcode.ts` (depends on jobQueue)
8. `backend/src/routes/stream.ts` (depends on config)
9. `backend/src/routes/history.ts` (depends on stats)
10. `backend/src/routes/rules.ts` (depends on config)
11. `backend/src/routes/events.ts` (depends on jobQueue SSE emitter)
12. `backend/src/index.ts` (depends on all routes)

### Phase 2 — Frontend

13. `frontend/package.json` + `frontend/vite.config.ts` + `frontend/tsconfig.json`
14. `frontend/src/router/index.ts`
15. `frontend/src/stores/status.ts` (SSE → reactive state)
16. `frontend/src/stores/queue.ts`
17. `frontend/src/components/FileBrowser.vue`
18. `frontend/src/components/TranscodeDialog.vue`
19. `frontend/src/components/JobCard.vue`
20. `frontend/src/components/VideoCompare.vue`
21. `frontend/src/views/BrowseView.vue` (depends on FileBrowser, TranscodeDialog)
22. `frontend/src/views/QueueView.vue` (depends on JobCard)
23. `frontend/src/views/HistoryView.vue` (depends on VideoCompare)
24. `frontend/src/views/SystemView.vue`
25. `frontend/src/App.vue` + `frontend/src/main.ts` + `frontend/index.html`
26. Migrate `web/styles.css` → `frontend/src/styles/main.css`

### Phase 3 — Packaging

27. `Dockerfile` (multi-stage)
28. `docker-compose.yml`
29. Delete `transcode.sh`, `admin_server.py`, `start.sh`, `web/`

---

## Verification steps

1. `cd backend && npm install && npm run build` — zero TypeScript errors
2. `cd frontend && npm install && npm run build` — Vite produces `dist/`
3. `docker build -t ffmpeg-easy-test .` — both stages succeed
4. `docker run -v ./media:/media:ro -v ./export:/export -v ./config:/config -p 8080:8080 ffmpeg-easy-test`
5. Browser: `http://localhost:8080` → Vue app loads, Browse view lists /media
6. Select a file, QP 26, submit → Queue shows live progress bar
7. After completion: History entry with savings; Compare opens VideoCompare with synced players
8. Test SW fallback: run without `/dev/dri` → libx265 used, logged warning
9. Test path traversal: `GET /api/fs?path=../../etc` → 400

---

## Scope — explicitly excluded

- Authentication/access control
- NVIDIA NVENC (only VAAPI + libx265 software fallback)
- Subtitle remux changes from current `-c:s copy` default
- Batch folder select (Phase 2 can be added later — single-file first)
