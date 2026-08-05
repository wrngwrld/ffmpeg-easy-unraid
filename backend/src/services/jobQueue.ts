import { randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { CONFIG_DIR, EXPORT_DIR, MEDIA_DIR, QUEUE_FILE } from "../config.js";
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
const runtimeHandles = new Map<string, ReturnType<typeof spawnTranscode>>();
const pausedBatchIds = new Set<string>();
let isInitialized = false;

interface QueuePayload {
  version: number;
  updatedAt: string;
  items: Job[];
}

function readRawQueue(): QueuePayload {
  try {
    const raw = fs.readFileSync(QUEUE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<QueuePayload>;
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    return {
      version: 1,
      updatedAt: "",
      items: [],
    };
  }
}

function writeRawQueue(payload: QueuePayload): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const tmp = QUEUE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tmp, QUEUE_FILE);
}

function persistQueue(): void {
  writeRawQueue({
    version: 1,
    updatedAt: new Date().toISOString(),
    items: [...jobs.values()],
  });
}

function normalizeRecoveredJob(job: Partial<Job>): Job | null {
  if (
    typeof job.id !== "string" ||
    typeof job.batchId !== "string" ||
    typeof job.sourcePath !== "string" ||
    typeof job.outputPath !== "string" ||
    typeof job.qp !== "number" ||
    (job.encoder !== "vaapi" &&
      job.encoder !== "videotoolbox" &&
      job.encoder !== "software") ||
    (job.streamSelection !== "all" && job.streamSelection !== "primary") ||
    (job.audioMode !== "copy" && job.audioMode !== "aac") ||
    (job.subtitleMode !== "copy" && job.subtitleMode !== "drop") ||
    typeof job.createdAt !== "string"
  ) {
    return null;
  }

  const recoveredState: JobState =
    job.state === "queued" || job.state === "running"
      ? "queued"
      : job.state === "done" ||
          job.state === "failed" ||
          job.state === "cancelled"
        ? job.state
        : "failed";

  return {
    id: job.id,
    batchId: job.batchId,
    sourcePath: job.sourcePath,
    outputPath: job.outputPath,
    createdAt: job.createdAt,
    qp: Math.max(0, Math.min(51, Math.floor(job.qp))),
    encoder: job.encoder,
    streamSelection: job.streamSelection,
    streamMap: job.streamMap,
    audioMode: job.audioMode,
    subtitleMode: job.subtitleMode,
    state: recoveredState,
    pct:
      recoveredState === "done"
        ? 100
        : typeof job.pct === "number"
          ? Math.max(0, Math.min(100, job.pct))
          : 0,
    speed: recoveredState === "queued" ? "n/a" : (job.speed ?? "n/a"),
    elapsed:
      recoveredState === "queued"
        ? 0
        : typeof job.elapsed === "number" && Number.isFinite(job.elapsed)
          ? Math.max(0, job.elapsed)
          : 0,
    startedAt:
      recoveredState === "queued"
        ? null
        : typeof job.startedAt === "string"
          ? job.startedAt
          : null,
    finishedAt:
      recoveredState === "done" ||
      recoveredState === "failed" ||
      recoveredState === "cancelled"
        ? typeof job.finishedAt === "string"
          ? job.finishedAt
          : null
        : null,
    error: typeof job.error === "string" ? job.error : null,
    inputBytes: typeof job.inputBytes === "number" ? job.inputBytes : null,
    outputBytes: typeof job.outputBytes === "number" ? job.outputBytes : null,
    savedBytes: typeof job.savedBytes === "number" ? job.savedBytes : null,
    savedPercent:
      typeof job.savedPercent === "number" ? job.savedPercent : null,
  };
}

export function initializeJobQueue(pausedBatchIdsToLoad: string[] = []): void {
  if (isInitialized) return;

  const payload = readRawQueue();
  for (const rawJob of payload.items) {
    const recovered = normalizeRecoveredJob(rawJob);
    if (!recovered) continue;
    jobs.set(recovered.id, recovered);
  }

  pausedBatchIds.clear();
  for (const batchId of pausedBatchIdsToLoad) {
    pausedBatchIds.add(batchId);
  }

  runningCount = 0;
  isInitialized = true;
  persistQueue();
  void drain();
}

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
    for (const job of jobs.values()) {
      if (job.batchId !== batchId) continue;
      if (job.state !== "running") continue;
      runtimeHandles.get(job.id)?.pause();
    }
  } else {
    pausedBatchIds.delete(batchId);
    for (const job of jobs.values()) {
      if (job.batchId !== batchId) continue;
      if (job.state !== "running") continue;
      runtimeHandles.get(job.id)?.resume();
    }
  }
  persistQueue();
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
    persistQueue();
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
  persistQueue();
  queueEvents.emit("event", { type: "job-added", job: snapshot(job) });
  void drain();
  return job;
}

export function cancelJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job) return false;

  if (job.state === "queued") {
    job.state = "cancelled";
    persistQueue();
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
  persistQueue();
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
    runtimeHandles.set(job.id, handle);

    cancelHandles.set(job.id, () => {
      cancelled = true;
      job.state = "cancelled";
      job.finishedAt = new Date().toISOString();
      persistQueue();
      handle.kill();
    });

    await handle.done;

    if (cancelled) {
      persistQueue();
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
    persistQueue();

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
      persistQueue();
      queueEvents.emit("event", { type: "job-cancelled", job: snapshot(job) });
      return;
    }

    job.state = "failed";
    job.finishedAt = new Date().toISOString();
    job.error = err instanceof Error ? err.message : String(err);
    persistQueue();

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
    runtimeHandles.delete(job.id);
  }
}
