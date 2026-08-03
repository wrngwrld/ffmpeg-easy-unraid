# FFmpeg-Easy-Unraid

<div align="center">
  <img src="./icon.png" width="150" height="150">
</div>

**A "Set and Forget" Batch Transcoder designed for Unraid.** Convert your media library (Movies, TV Series) to modern, space-saving formats (H.265/HEVC or AV1) with ease.

---

## 📖 About The Project

**FFmpeg-Easy-Unraid** is a Docker container built to simplify the process of shrinking large video libraries. It automatically scans an input directory, converts video files to highly efficient formats, and moves the original files to a "finished" folder upon success.

It is designed to be robust ("fail-safe"), supporting modern hardware acceleration while protecting your server from freezing via intelligent CPU monitoring.

### Key Features

- **Run-Once Workflow:** This container is designed to run on demand. It scans the `/import` directory on startup, processes the queue, and **stops automatically** when finished. It does not continuously monitor the folder to save resources. **To process a new batch, simply restart the container.**
- **Modern Codecs:** Supports **H.265 (HEVC)** and **AV1**.
- **Hardware Acceleration:** Full support for **Nvidia NVENC**, **Intel QuickSync/Arc**, and optimized CPU encoding.
- **Smart Workflow:**
  - Scans `/import` for media.
  - Transcodes to `/export`.
  - Moves successfully processed originals to `/import/finished`.
  - **Directory Preservation:** Perfect for TV Shows! Recursively scans folders and recreates the exact directory structure (e.g., `Series Name/Season 1/`) in the output.
- **Safety First:** Detects if CPU pinning is active. If not, it automatically limits thread usage to **50% of available cores** to prevent Unraid from freezing.
- **Detailed Stats:** Displays exact space savings (GB/MB and %) after every run.
- **Container Standardization:** Automatically outputs to **.MKV** for maximum compatibility with subtitles and audio tracks.
- **Optional Watch Mode:** Can run continuously and auto-start a new transcode batch when new files appear in `/import`.

---

## 🟢 How to Enable Nvidia Support (Important!)

By default, Docker containers cannot see your Graphics Card. To enable **Nvidia NVENC** support, follow these steps strictly:

### Step 1: Install the Driver

In Unraid, go to the "Apps" tab (Community Applications) and install the **"Nvidia Driver"** plugin. Reboot if asked.

### Step 2: Configure the Container

When adding or editing this container in Unraid:

1. Switch to **"Advanced View"** (toggle in the top right corner).
2. Find the field **"Extra Parameters"**.
3. Add the following text to the end of the line (separated by a space):

   ```text
   --runtime=nvidia
   *(Note: Do not remove `--cap-add=SYS_NICE` if it is already there. Just add this after it.)*

   ```

4. Find the Variable **"Nvidia Visible Devices"** (in Advanced View).

- Set this to your **GPU UUID** (recommended, found in the Nvidia Driver Plugin settings).
- OR set it to `all` if you only have one GPU.

5. **Apply** the changes.

The container will now perform a hardware check on startup. If successful, logs will show `[INIT] Hardware check passed`.

---

## ⚖️ CPU vs. GPU Encoding: What should I choose?

- **Choose CPU Encoding (`cpu_h265`)** if you want the **best possible compression efficiency and quality preservation**. CPU encoders (libx265) are generally smarter than GPU encoders, resulting in smaller files for the same visual quality. Ideally, use this for long-term archiving.
- **Choose GPU Encoding (`nvidia_...` / `intel_...`)** if **speed** is your priority. GPUs can process files much faster, but the file size might be slightly larger to achieve the same visual quality compared to CPU encoding.

---

## ⚙️ Prerequisites

### 1. For Intel GPU Encoding (QuickSync / Arc)

- **Device Mapping:** You must pass the device `/dev/dri` to the container.
- **AV1 Support:** Requires an **Intel Arc GPU** or newer iGPU (Meteor Lake+).

### 2. For CPU Encoding

- **Recommendation:** Use **CPU Pinning** in the Unraid Docker settings to assign specific cores. If you forget this, the script's safety mode will engage (limiting to 50% load).

---

## 🚀 Configuration & Environment Variables

The container is controlled via Environment Variables.

### A Note on Defaults

> **Why these default values?**
> The default settings (CRF 18 for H.265 / CRF 24 for AV1) are chosen based on extensive personal testing. In my experience, these values represent the **"Sweet Spot"**: they provide significant file size reduction while maintaining visual quality that is virtually indistinguishable from the source.
> Unless you have specific needs, I recommend leaving the Quality fields empty to use these smart defaults.

### Variable List

| Variable                     | Default    | Description                                                                                                                                                                                       |
| :--------------------------- | :--------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ENCODE_METHOD`              | `cpu_h265` | **The Encoder Engine.**<br>Options: `cpu_h265`, `cpu_av1`, `nvidia_h265`, `nvidia_av1`, `intel_h265`, `intel_av1`.                                                                                |
| `ENCODE_PRESET`              | `default`  | **Speed vs. Efficiency.**<br>`default` automatically picks `medium` (CPU) or `p4` (Nvidia).<br>Manual options: `slow`, `fast`, `p1`-`p7` (Nvidia), `0`-`13` (SVT-AV1).                            |
| `ENCODE_THREADS`             | `0`        | **CPU Usage.**<br>`0` = Auto-Detect (Checks for pinning).<br>Set a number (e.g., `4`) to force a specific thread count. Only affects CPU encoding.                                                |
| `ENCODE_PARALLEL_JOBS`       | `1`        | **Files in Parallel.**<br>How many files to transcode at the same time.<br>`1` = sequential (default).<br>Recommended: `2` for GPU methods, `1` for CPU methods unless you have many spare cores. |
| `ENCODE_WATCH_MODE`          | `0`        | **Continuous Folder Watch.**<br>`0` = Run once and stop.<br>`1` = Keep container running and automatically process new files when they are copied into `/import`.                                 |
| `ENCODE_WATCH_POLL_SECONDS`  | `30`       | **Watch Fallback Interval.**<br>Used only if inotify is unavailable inside the container.<br>Minimum valid value: `5`.                                                                            |
| `ENCODE_FILE_STABLE_SECONDS` | `5`        | **Copy Safety Gate.**<br>Before encoding starts, file size must remain unchanged for this many seconds.<br>Set `0` to disable the stability wait.                                                 |
| `ENCODE_LIVE_PREVIEW`        | `1`        | **Live Encode Progress in Logs.**<br>`1` = show ongoing ffmpeg progress output while encoding.<br>`0` = quieter logs.                                                                             |
| `ENCODE_PROGRESS_INTERVAL`   | `2`        | **Progress Update Interval (seconds).**<br>How often live progress is emitted when live preview is enabled.<br>Minimum valid value: `1`.                                                          |
| `ENCODE_CRF`                 | _(Smart)_  | **Quality for CPU/Intel.**<br>Lower value = Better Quality, Larger File.<br>Defaults: `18` (H.265), `24` (AV1).                                                                                   |
| `ENCODE_CQ`                  | _(Smart)_  | **Quality for Nvidia.**<br>Lower value = Better Quality, Larger File.<br>Defaults: `19` (H.265), `24` (AV1).                                                                                      |
| `ENCODE_MAP_ARGS`            | `-map 0`   | **Stream Selection.**<br>Default maps all streams (video, all audio tracks, subtitles, attachments).<br>Example for smaller files: `-map 0:v:0 -map 0:a:0` (first video + first audio only).      |
| `FFMPEG_CUSTOM_ARGS`         | _(Empty)_  | **Audio/Subtitles Override.**<br>Default behavior is `-c:a copy -c:s copy`.<br>Use this to convert audio, e.g., `-c:a aac -b:a 192k`.                                                             |
| `NVIDIA_VISIBLE_DEVICES`     | `all`      | **GPU Selection.**<br>Set to your GPU UUID (e.g., `GPU-xxxx...`) or `all`.                                                                                                                        |
| `UNRAID_UID`                 | `99`       | User ID for file permissions (Standard Unraid: 99).                                                                                                                                               |
| `UNRAID_GID`                 | `100`      | Group ID for file permissions (Standard Unraid: 100).                                                                                                                                             |

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
```

This approximates your HandBrake behavior (first video + first audio, AAC stereo, no subtitles). HDR sources remain HDR with the script's HDR-preservation logic.

### Recommended Profiles (i5-13400)

Use one of these ready-made profiles as a starting point.

#### Profile A: Fast + Safe (mixed library, recommended)

```text
ENCODE_METHOD=intel_h265
ENCODE_PRESET=default
ENCODE_QP=22
ENCODE_PARALLEL_JOBS=2
ENCODE_MAP_ARGS=-map 0:v:0 -map 0:a:0
FFMPEG_CUSTOM_ARGS=-c:a aac -b:a 160k -ac 2 -sn
```

Best default for your CPU/iGPU combo. Good speed, good size reduction, stable for most 1080p and many 4K jobs.

#### Profile B: 4K HDR Stability (larger files, fewer surprises)

```text
ENCODE_METHOD=intel_h265
ENCODE_PRESET=default
ENCODE_QP=20
ENCODE_PARALLEL_JOBS=2
ENCODE_MAP_ARGS=-map 0:v:0 -map 0:a:0
FFMPEG_CUSTOM_ARGS=-c:a copy -sn
```

Use this if your source is mostly 4K HDR and you want to keep quality more conservatively.

#### Profile C: Maximum Shrink (slower and lower quality)

```text
ENCODE_METHOD=intel_h265
ENCODE_PRESET=default
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
