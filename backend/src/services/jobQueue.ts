import { randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import { EXPORT_DIR, MEDIA_DIR } from "../config.js";
import { readSettings } from "./settings.js";
import {
  spawnTranscode,
  getFileDuration,
  isEncoderAvailable,
} from "./ffmpeg.js";
import { recordEntry } from "./stats.js";
import { upsertApproval } from "./approvals.js";
import { getBatch } from "./batches.js";

export type JobState = "queued" | "running" | "done" | "failed" | "cancelled";
export type EncoderChoice = "vaapi" | "videotoolbox" | "software";
export type StreamSelection = "all" | "primary";
export interface StreamMapSelection {
  videoIndex?: number;
  audioIndex?: number | null;
  subtitleIndex?: number | null;
}
export type AudioMode = "copy" | "aac";
export type SubtitleMode = "copy" | "drop";

export interface Job {
  id: string;
  batchId: string;
  sourcePath: string;
  outputPath: string;
  qp: number;
  encoder: EncoderChoice;
  streamSelection: StreamSelection;
  streamMap?: StreamMapSelection;
  audioMode: AudioMode;
  subtitleMode: SubtitleMode;
  state: JobState;
  pct: number;
  speed: string;
  elapsed: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  inputBytes: number | null;
  outputBytes: number | null;
  savedBytes: number | null;
  savedPercent: number | null;
}

// SSE event bus — routes/events.ts subscribes to this
export const queueEvents = new EventEmitter();
queueEvents.setMaxListeners(200);

const jobs = new Map<string, Job>();
let runningCount = 0;
let parallelJobs = readSettings().parallelJobs;
const cancelHandles = new Map<string, () => void>();
const pausedBatchIds = new Set<string>();

export function getParallelJobs(): number {
  return parallelJobs;
}

export function setParallelJobs(next: number): number {
  parallelJobs = Math.max(1, Math.floor(next) || 1);
  queueEvents.emit("event", {
    type: "settings-updated",
    parallelJobs,
  });
  void drain();
  return parallelJobs;
}

export function getJobs(): Job[] {
  return [...jobs.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function setBatchPausedInQueue(batchId: string, paused: boolean): void {
  if (paused) {
    pausedBatchIds.add(batchId);
  } else {
    pausedBatchIds.delete(batchId);
  }
  void drain();
}

export function cancelRemainingByBatch(batchId: string): number {
  let cancelled = 0;
  for (const job of jobs.values()) {
    if (job.batchId !== batchId) continue;
    if (job.state !== "queued") continue;
    job.state = "cancelled";
    queueEvents.emit("event", { type: "job-cancelled", job: snapshot(job) });
    cancelled += 1;
  }
  if (cancelled > 0) {
    void drain();
  }
  return cancelled;
}

function outputPathFor(sourcePath: string): string {
  const { dir, name } = path.parse(sourcePath);
  return path.join(dir, name + ".mkv");
}

export function addJob(
  batchId: string,
  sourcePath: string,
  qp: number,
  encoder: EncoderChoice,
  streamSelection: StreamSelection = "all",
  streamMap: StreamMapSelection | undefined = undefined,
  audioMode: AudioMode = "copy",
  subtitleMode: SubtitleMode = "copy",
): Job {
  const effectiveEncoder: EncoderChoice =
    encoder === "vaapi" && !isEncoderAvailable("vaapi")
      ? "software"
      : encoder === "videotoolbox" && !isEncoderAvailable("videotoolbox")
        ? "software"
        : encoder;

  const job: Job = {
    id: randomUUID(),
    batchId,
    sourcePath,
    outputPath: outputPathFor(sourcePath),
    qp,
    encoder: effectiveEncoder,
    streamSelection,
    streamMap,
    audioMode,
    subtitleMode,
    state: "queued",
    pct: 0,
    speed: "n/a",
    elapsed: 0,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    error: null,
    inputBytes: null,
    outputBytes: null,
    savedBytes: null,
    savedPercent: null,
  };

  jobs.set(job.id, job);
  queueEvents.emit("event", { type: "job-added", job: snapshot(job) });
  void drain();
  return job;
}

export function cancelJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job) return false;

  if (job.state === "queued") {
    job.state = "cancelled";
    queueEvents.emit("event", { type: "job-cancelled", job: snapshot(job) });
    return true;
  }

  if (job.state === "running") {
    cancelHandles.get(id)?.();
    return true;
  }

  return false;
}

function snapshot(job: Job): Job {
  return { ...job };
}

async function drain(): Promise<void> {
  while (runningCount < parallelJobs) {
    const next = [...jobs.values()].find(
      (j) => j.state === "queued" && !pausedBatchIds.has(j.batchId),
    );
    if (!next) break;
    runningCount++;
    runJob(next).finally(() => {
      runningCount--;
      void drain();
    });
  }
}

async function runJob(job: Job): Promise<void> {
  job.state = "running";
  job.startedAt = new Date().toISOString();
  queueEvents.emit("event", { type: "job-progress", job: snapshot(job) });

  const sourceAbs = path.join(MEDIA_DIR, job.sourcePath);
  const outputAbs = path.join(EXPORT_DIR, job.outputPath);

  let cancelled = false;

  try {
    await mkdir(path.dirname(outputAbs), { recursive: true });

    const durationSeconds = getFileDuration(sourceAbs);

    let inputBytes = 0;
    try {
      inputBytes = (await stat(sourceAbs)).size;
    } catch {
      /* non-fatal */
    }

    const handle = spawnTranscode({
      id: job.id,
      sourcePath: job.sourcePath,
      outputPath: job.outputPath,
      qp: job.qp,
      encoder: job.encoder,
      streamSelection: job.streamSelection,
      streamMap: job.streamMap,
      audioMode: job.audioMode,
      subtitleMode: job.subtitleMode,
      durationSeconds,
      onProgress: (pct, speed, elapsed) => {
        if (cancelled) return;
        job.pct = pct;
        job.speed = speed;
        job.elapsed = elapsed;
        queueEvents.emit("event", { type: "job-progress", job: snapshot(job) });
      },
    });

    cancelHandles.set(job.id, () => {
      cancelled = true;
      job.state = "cancelled";
      handle.kill();
    });

    await handle.done;

    if (cancelled) {
      queueEvents.emit("event", { type: "job-cancelled", job: snapshot(job) });
      return;
    }

    let outputBytes = 0;
    try {
      outputBytes = (await stat(outputAbs)).size;
    } catch {
      /* non-fatal */
    }

    job.state = "done";
    job.pct = 100;
    job.finishedAt = new Date().toISOString();
    job.inputBytes = inputBytes;
    job.outputBytes = outputBytes;
    job.savedBytes = inputBytes - outputBytes;
    job.savedPercent =
      inputBytes > 0 ? ((inputBytes - outputBytes) / inputBytes) * 100 : 0;

    recordEntry({
      timestamp: job.finishedAt,
      relativePath: job.sourcePath,
      status: "succeeded",
      method:
        job.encoder === "vaapi"
          ? "intel_h265"
          : job.encoder === "videotoolbox"
            ? "videotoolbox_h265"
            : "libx265",
      qp: job.qp,
      inputBytes,
      outputBytes,
      savedBytes: job.savedBytes,
      savedPercent: job.savedPercent,
    });

    upsertApproval({
      batchId: job.batchId,
      batchName: getBatch(job.batchId)?.name ?? null,
      sourcePath: job.sourcePath,
      outputPath: job.outputPath,
      createdAt: job.createdAt,
      completedAt: job.finishedAt,
      qp: job.qp,
      encoder: job.encoder,
      inputBytes: job.inputBytes,
      outputBytes: job.outputBytes,
      savedPercent: job.savedPercent,
    });

    queueEvents.emit("event", { type: "job-done", job: snapshot(job) });
  } catch (err) {
    if (cancelled) {
      queueEvents.emit("event", { type: "job-cancelled", job: snapshot(job) });
      return;
    }

    job.state = "failed";
    job.finishedAt = new Date().toISOString();
    job.error = err instanceof Error ? err.message : String(err);

    recordEntry({
      timestamp: job.finishedAt,
      relativePath: job.sourcePath,
      status: "failed",
      method:
        job.encoder === "vaapi"
          ? "intel_h265"
          : job.encoder === "videotoolbox"
            ? "videotoolbox_h265"
            : "libx265",
      qp: job.qp,
      inputBytes: 0,
      outputBytes: 0,
      savedBytes: 0,
      savedPercent: 0,
    });

    queueEvents.emit("event", { type: "job-failed", job: snapshot(job) });
  } finally {
    cancelHandles.delete(job.id);
  }
}
