# FFmpeg-Easy-Unraid

<div align="center">
  <img src="./icon.png" width="150" height="150">
</div>

**A "Set and Forget" Batch Transcoder designed for Unraid.** Convert your media library (Movies, TV Series) to space-saving H.265/HEVC with Intel QuickSync.

---

## 📖 About The Project

**FFmpeg-Easy-Unraid** is a Docker container built to simplify the process of shrinking large video libraries. It automatically scans an input directory, converts video files to highly efficient formats, and moves the original files to a "finished" folder upon success.

It is designed to be robust ("fail-safe") and focused on Intel QuickSync H.265 for a simple, stable workflow.

### Key Features

- **Run-Once Workflow:** This container is designed to run on demand. It scans the `/import` directory on startup, processes the queue, and **stops automatically** when finished. It does not continuously monitor the folder to save resources. **To process a new batch, simply restart the container.**
- **Focused Codec Path:** Encodes to **H.265 (HEVC)**.
- **Hardware Acceleration:** Optimized for **Intel QuickSync/Arc** (`intel_h265`).
- **Smart Workflow:**
  - Scans `/import` for media.
  - Transcodes to `/export`.
  - Moves successfully processed originals to `/import/finished`.
  - **Directory Preservation:** Perfect for TV Shows! Recursively scans folders and recreates the exact directory structure (e.g., `Series Name/Season 1/`) in the output.
- **Safety First:** Intel QuickSync path with optional file-stability checks to avoid processing partial copies.
- **Detailed Stats:** Displays exact space savings (GB/MB and %) after every run.
- **Container Standardization:** Automatically outputs to **.MKV** for maximum compatibility with subtitles and audio tracks.
- **Optional Watch Mode:** Can run continuously and auto-start a new transcode batch when new files appear in `/import`.

---

## 🟢 Intel QuickSync Setup (Required)

This project now supports only `intel_h265`.

When adding or editing this container in Unraid:

1. Enable device mapping for Intel graphics by passing `/dev/dri` into the container.
2. Apply changes and start the container.

On startup, the container runs a QuickSync hardware check. If successful, encoding starts automatically.

---

## ⚙️ Prerequisites

### 1. For Intel GPU Encoding (QuickSync / Arc)

- **Device Mapping:** You must pass the device `/dev/dri` to the container.

---

## 🚀 Configuration & Environment Variables

The container is controlled via Environment Variables.

### A Note on Defaults

> **Why these default values?**
> The defaults are tuned for stable Intel QuickSync H.265 operation with good visual quality and meaningful size savings.

### Variable List

| Variable                     | Default      | Description                                                                                                                                                                                  |
| :--------------------------- | :----------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENCODE_METHOD`              | `intel_h265` | **Encoder Engine.**<br>Only `intel_h265` is supported. Other values are forced to `intel_h265` with a warning.                                                                               |
| `ENCODE_PARALLEL_JOBS`       | `1`          | **Files in Parallel.**<br>How many files to transcode at the same time.<br>`1` = sequential (default).<br>Recommended: `2` for most systems, optionally `3` if stable.                       |
| `ENCODE_WATCH_MODE`          | `0`          | **Continuous Folder Watch.**<br>`0` = Run once and stop.<br>`1` = Keep container running and automatically process new files when they are copied into `/import`.                            |
| `ENCODE_WATCH_POLL_SECONDS`  | `30`         | **Watch Fallback Interval.**<br>Used only if inotify is unavailable inside the container.<br>Minimum valid value: `5`.                                                                       |
| `ENCODE_FILE_STABLE_SECONDS` | `5`          | **Copy Safety Gate.**<br>Before encoding starts, file size must remain unchanged for this many seconds.<br>Set `0` to disable the stability wait.                                            |
| `ENCODE_LIVE_PREVIEW`        | `1`          | **Live Encode Progress in Logs.**<br>`1` = show ongoing ffmpeg progress output while encoding.<br>`0` = quieter logs.                                                                        |
| `ENCODE_PROGRESS_INTERVAL`   | `2`          | **Progress Update Interval (seconds).**<br>How often live progress is emitted when live preview is enabled.<br>Minimum valid value: `1`.                                                     |
| `ENCODE_LOG_MODE`            | `detailed`   | **Live Log Verbosity.**<br>`detailed` = ffmpeg live lines + heartbeat.<br>`compact` = only start/heartbeat/final status (plus ffmpeg error tail on failure).                                 |
| `ENCODE_BITRATE_MODE`        | `quality`    | **Video Rate Control Mode.**<br>`quality` = QP quality mode (default).<br>`source` = use detected source video bitrate (`-b:v`) per file; if unavailable, falls back to quality mode.        |
| `ENCODE_HEARTBEAT_SECONDS`   | `10`         | **Live Heartbeat Interval (seconds).**<br>Emits periodic runtime/output-size updates per active encode job to guarantee visible progress even when ffmpeg progress is sparse.                |
| `ENCODE_QP`                  | `22`         | **Intel H.265 Quality Control.**<br>Lower = better quality/larger files, higher = smaller files/lower quality.                                                                               |
| `ENCODE_MAP_ARGS`            | `-map 0`     | **Stream Selection.**<br>Default maps all streams (video, all audio tracks, subtitles, attachments).<br>Example for smaller files: `-map 0:v:0 -map 0:a:0` (first video + first audio only). |
| `FFMPEG_CUSTOM_ARGS`         | _(Empty)_    | **Audio/Subtitles Override.**<br>Default behavior is `-c:a copy -c:s copy`.<br>Use this to convert audio, e.g., `-c:a aac -b:a 192k`.                                                        |
| `UNRAID_UID`                 | `99`         | User ID for file permissions (Standard Unraid: 99).                                                                                                                                          |
| `UNRAID_GID`                 | `100`        | Group ID for file permissions (Standard Unraid: 100).                                                                                                                                        |

### HandBrake-Like Smaller File Setup

If your HandBrake preset creates significantly smaller files, the biggest reason is often **track selection and audio conversion** (not only video quality).

Try this configuration:

```text
ENCODE_MAP_ARGS=-map 0:v:0 -map 0:a:0
FFMPEG_CUSTOM_ARGS=-c:a aac -b:a 160k -ac 2 -sn
```

Optional parallelism (for speed):

```text
ENCODE_PARALLEL_JOBS=2
```

Automatic processing when new files arrive:

```text
ENCODE_WATCH_MODE=1
ENCODE_FILE_STABLE_SECONDS=5
```

Live encode preview in logs:

```text
ENCODE_LIVE_PREVIEW=1
ENCODE_PROGRESS_INTERVAL=2
ENCODE_HEARTBEAT_SECONDS=10
ENCODE_LOG_MODE=compact
```

Use source-like bitrate behavior:

```text
ENCODE_BITRATE_MODE=source
```

Color range behavior:

```text
source color range is auto-passed through when available (tv/pc)
```

This approximates your HandBrake behavior (first video + first audio, AAC stereo, no subtitles). HDR sources remain HDR with the script's HDR-preservation logic.

### Recommended Profiles (i5-13400)

Use one of these ready-made profiles as a starting point.

#### Profile A: Fast + Safe (mixed library, recommended)

```text
ENCODE_METHOD=intel_h265
ENCODE_QP=22
ENCODE_PARALLEL_JOBS=2
ENCODE_MAP_ARGS=-map 0:v:0 -map 0:a:0
FFMPEG_CUSTOM_ARGS=-c:a aac -b:a 160k -ac 2 -sn
```

Best default for your CPU/iGPU combo. Good speed, good size reduction, stable for most 1080p and many 4K jobs.

#### Profile B: 4K HDR Stability (larger files, fewer surprises)

```text
ENCODE_METHOD=intel_h265
ENCODE_QP=20
ENCODE_PARALLEL_JOBS=2
ENCODE_MAP_ARGS=-map 0:v:0 -map 0:a:0
FFMPEG_CUSTOM_ARGS=-c:a copy -sn
```

Use this if your source is mostly 4K HDR and you want to keep quality more conservatively.

#### Profile C: Maximum Shrink (slower and lower quality)

```text
ENCODE_METHOD=intel_h265
ENCODE_QP=24
ENCODE_PARALLEL_JOBS=3
ENCODE_MAP_ARGS=-map 0:v:0 -map 0:a:0
FFMPEG_CUSTOM_ARGS=-c:a aac -b:a 128k -ac 2 -sn
```

Use this only if your main goal is smallest size. If quality drops too much, go back to Profile A.

Quick tuning rule:

- Smaller files: raise QP by +1
- Better quality: lower QP by -1
- If you see instability or slowdowns with 3 jobs, set ENCODE_PARALLEL_JOBS back to 2

---

## 📂 Folder Structure (Mappings)

You need to map two volumes in Docker/Unraid:

1. **Input:** Map your source media folder to `/import`.

- _Note:_ The container needs **Read/Write** access to move finished files to `/import/finished`.

2. **Output:** Map your destination folder to `/export`.

**Example Workflow:**

1. You place a TV Show folder `MySeries/Season 1/Episode 1.mkv` in `/import`.
2. Script converts it and saves the new version to `/export/MySeries/Season 1/Episode 1.mkv`.
3. Script moves the original to `/import/finished/MySeries/Season 1/Episode 1.mkv`.
4. **Container Stops.** To convert new files later, simply restart the container.

---

## 📜 License

Distributed under the **GPL-3.0 license**. See `LICENSE` for more information.

---

**Author:** [metronade](https://github.com/metronade)

```

```
