import type { FastifyPluginAsync } from "fastify";
import fs from "node:fs";
import path from "node:path";
import {
  addJob,
  cancelRemainingByBatch,
  cancelJob,
  getJobs,
  getParallelJobs,
  queueEvents,
  setBatchPausedInQueue,
} from "../services/jobQueue.js";
import {
  getAvailableEncoders,
  pickPrimaryStreamMap,
  probeMediaStreams,
} from "../services/ffmpeg.js";
import type {
  AudioMode,
  EncoderChoice,
  StreamSelection,
  SubtitleMode,
  StreamMapSelection,
} from "../services/jobQueue.js";
import { MEDIA_DIR, MEDIA_EXTENSIONS } from "../config.js";
import { readSettings } from "../services/settings.js";
import {
  appendBatchJobs,
  createBatch,
  getBatch,
  listBatches,
  setBatchPaused,
  type BatchOptions,
} from "../services/batches.js";

interface TranscodeBody {
  sourcePath: string;
  batchName?: string;
  qp?: number;
  encoder?: string;
  streamSelection?: string;
  streamMap?: {
    videoIndex?: number;
    audioIndex?: number | null;
    subtitleIndex?: number | null;
  };
  audioMode?: string;
  subtitleMode?: string;
}

interface TranscodeFolderBody {
  folderPath: string;
  batchName?: string;
  qp?: number;
  encoder?: string;
  streamSelection?: string;
  streamMap?: {
    videoIndex?: number;
    audioIndex?: number | null;
    subtitleIndex?: number | null;
  };
  audioMode?: string;
  subtitleMode?: string;
}

function defaultBatchName(inputPath: string): string {
  const clean = inputPath.trim().replace(/[\\/]+$/, "");
  const base = path.basename(clean);
  return base || "Batch";
}

function pickBatchName(inputPath: string, rawBatchName: unknown): string {
  if (typeof rawBatchName !== "string") return defaultBatchName(inputPath);
  const trimmed = rawBatchName.trim();
  return trimmed.length ? trimmed : defaultBatchName(inputPath);
}

function normalizeStreamMap(
  streamMap: TranscodeBody["streamMap"] | undefined,
): StreamMapSelection | undefined {
  if (!streamMap) return undefined;

  const norm: StreamMapSelection = {};

  if (streamMap.videoIndex !== undefined) {
    if (!Number.isInteger(streamMap.videoIndex) || streamMap.videoIndex < 0) {
      throw new Error("streamMap.videoIndex must be a non-negative integer");
    }
    norm.videoIndex = streamMap.videoIndex;
  }

  if (streamMap.audioIndex === null) {
    norm.audioIndex = null;
  } else if (streamMap.audioIndex !== undefined) {
    if (!Number.isInteger(streamMap.audioIndex) || streamMap.audioIndex < 0) {
      throw new Error(
        "streamMap.audioIndex must be a non-negative integer or null",
      );
    }
    norm.audioIndex = streamMap.audioIndex;
  }

  if (streamMap.subtitleIndex === null) {
    norm.subtitleIndex = null;
  } else if (streamMap.subtitleIndex !== undefined) {
    if (
      !Number.isInteger(streamMap.subtitleIndex) ||
      streamMap.subtitleIndex < 0
    ) {
      throw new Error(
        "streamMap.subtitleIndex must be a non-negative integer or null",
      );
    }
    norm.subtitleIndex = streamMap.subtitleIndex;
  }

  return norm;
}

function pickEncoder(encoder: string | undefined): EncoderChoice {
  const available = new Set(getAvailableEncoders());

  return encoder === "software"
    ? "software"
    : encoder === "videotoolbox"
      ? available.has("videotoolbox")
        ? "videotoolbox"
        : "software"
      : encoder === "vaapi"
        ? available.has("vaapi")
          ? "vaapi"
          : "software"
        : available.has("vaapi")
          ? "vaapi"
          : available.has("videotoolbox")
            ? "videotoolbox"
            : "software";
}

function pickSubtitleMode(mode: string | undefined): SubtitleMode {
  return mode === "drop" ? "drop" : "copy";
}

function pickStreamSelection(mode: string | undefined): StreamSelection {
  return mode === "primary" ? "primary" : "all";
}

function pickAudioMode(mode: string | undefined): AudioMode {
  return mode === "aac" ? "aac" : "copy";
}

function safePath(reqPath: string): string | null {
  const rel = path.normalize(reqPath ?? "").replace(/^[/\\]+/, "");
  const abs = path.resolve(MEDIA_DIR, rel);
  if (!abs.startsWith(path.resolve(MEDIA_DIR))) return null;
  return abs;
}

function collectMediaFiles(absFolder: string): string[] {
  const files: string[] = [];
  const stack = [absFolder];

  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;

    let dirents: fs.Dirent[] = [];
    try {
      dirents = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const d of dirents) {
      if (d.name.startsWith(".")) continue;
      const abs = path.join(current, d.name);

      if (d.isDirectory()) {
        stack.push(abs);
        continue;
      }

      if (!d.isFile()) continue;
      const ext = path.extname(d.name).toLowerCase();
      if (!MEDIA_EXTENSIONS.has(ext)) continue;

      const rel = "/" + path.relative(MEDIA_DIR, abs).replace(/\\/g, "/");
      files.push(rel);
    }
  }

  return files.sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

const transcodeRoute: FastifyPluginAsync = async (fastify) => {
  for (const batch of listBatches()) {
    if (batch.paused) {
      setBatchPausedInQueue(batch.id, true);
    }
  }

  fastify.get("/api/jobs", async () => ({
    jobs: getJobs(),
    batches: listBatches(),
    availableEncoders: getAvailableEncoders(),
    parallelJobs: getParallelJobs(),
  }));

  fastify.get("/api/batches", async () => ({
    batches: listBatches(),
  }));

  fastify.post<{ Params: { id: string } }>(
    "/api/batches/:id/pause",
    async (req, reply) => {
      const batch = setBatchPaused(req.params.id, true);
      if (!batch) {
        return reply.code(404).send({ error: "Batch not found" });
      }

      setBatchPausedInQueue(batch.id, true);
      queueEvents.emit("event", { type: "batch-updated", batch });
      return { batch };
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/batches/:id/resume",
    async (req, reply) => {
      const batch = setBatchPaused(req.params.id, false);
      if (!batch) {
        return reply.code(404).send({ error: "Batch not found" });
      }

      setBatchPausedInQueue(batch.id, false);
      queueEvents.emit("event", { type: "batch-updated", batch });
      return { batch };
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/batches/:id/cancel-remaining",
    async (req, reply) => {
      const batch = getBatch(req.params.id);
      if (!batch) {
        return reply.code(404).send({ error: "Batch not found" });
      }

      const cancelled = cancelRemainingByBatch(batch.id);
      return { cancelled, batchId: batch.id };
    },
  );

  fastify.post<{ Body: TranscodeBody }>(
    "/api/transcode",
    async (req, reply) => {
      const {
        sourcePath,
        batchName,
        qp,
        encoder,
        streamSelection,
        streamMap,
        audioMode,
        subtitleMode,
      } = req.body ?? {};
      const appSettings = readSettings();
      const defaults = appSettings.defaultTranscode;
      const streamPrefs = appSettings.defaultStreamMatching;

      if (
        !sourcePath ||
        typeof sourcePath !== "string" ||
        sourcePath.trim() === ""
      ) {
        return reply.code(400).send({ error: "sourcePath is required" });
      }
      const effectiveQp = qp ?? defaults.qp;
      if (
        typeof effectiveQp !== "number" ||
        !Number.isInteger(effectiveQp) ||
        effectiveQp < 0 ||
        effectiveQp > 51
      ) {
        return reply.code(400).send({ error: "qp must be an integer 0–51" });
      }

      const chosenEncoder: EncoderChoice = pickEncoder(
        encoder ?? defaults.encoder,
      );
      const chosenStreamSelection = pickStreamSelection(
        streamSelection ?? defaults.streamSelection,
      );
      let chosenStreamMap: StreamMapSelection | undefined;
      try {
        chosenStreamMap = normalizeStreamMap(streamMap);
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : String(err) });
      }
      const chosenAudioMode = pickAudioMode(audioMode ?? defaults.audioMode);
      const chosenSubtitleMode = pickSubtitleMode(
        subtitleMode ?? defaults.subtitleMode,
      );

      if (chosenStreamSelection === "primary" && !chosenStreamMap) {
        const abs = safePath(sourcePath.trim());
        if (abs) {
          const probed = probeMediaStreams(abs);
          chosenStreamMap = pickPrimaryStreamMap(probed, streamPrefs);
        }
      }

      const batchOptions: BatchOptions = {
        qp: effectiveQp,
        encoder: chosenEncoder,
        streamSelection: chosenStreamSelection,
        streamMap: chosenStreamMap,
        audioMode: chosenAudioMode,
        subtitleMode: chosenSubtitleMode,
        streamMatching: streamPrefs,
      };

      const batch = createBatch({
        name: pickBatchName(sourcePath, batchName),
        sourcePath: sourcePath.trim(),
        kind: "single",
        options: batchOptions,
      });
      queueEvents.emit("event", { type: "batch-added", batch });

      const job = addJob(
        batch.id,
        sourcePath.trim(),
        effectiveQp,
        chosenEncoder,
        chosenStreamSelection,
        chosenStreamMap,
        chosenAudioMode,
        chosenSubtitleMode,
      );
      const updatedBatch = appendBatchJobs(batch.id, [job.id]);
      if (updatedBatch) {
        queueEvents.emit("event", {
          type: "batch-updated",
          batch: updatedBatch,
        });
      }
      return reply.code(201).send({ jobId: job.id, batchId: batch.id, job });
    },
  );

  fastify.post<{ Body: TranscodeFolderBody }>(
    "/api/transcode/folder",
    async (req, reply) => {
      const {
        folderPath,
        batchName,
        qp,
        encoder,
        streamSelection,
        streamMap,
        audioMode,
        subtitleMode,
      } = req.body ?? {};
      const appSettings = readSettings();
      const defaults = appSettings.defaultTranscode;
      const streamPrefs = appSettings.defaultStreamMatching;

      if (
        !folderPath ||
        typeof folderPath !== "string" ||
        folderPath.trim() === ""
      ) {
        return reply.code(400).send({ error: "folderPath is required" });
      }
      const effectiveQp = qp ?? defaults.qp;
      if (
        typeof effectiveQp !== "number" ||
        !Number.isInteger(effectiveQp) ||
        effectiveQp < 0 ||
        effectiveQp > 51
      ) {
        return reply.code(400).send({ error: "qp must be an integer 0–51" });
      }

      const abs = safePath(folderPath.trim());
      if (!abs) return reply.code(400).send({ error: "Invalid folderPath" });

      let st: fs.Stats;
      try {
        st = fs.statSync(abs);
      } catch {
        return reply.code(404).send({ error: "Folder not found" });
      }
      if (!st.isDirectory()) {
        return reply
          .code(400)
          .send({ error: "folderPath must be a directory" });
      }

      const files = collectMediaFiles(abs);
      if (!files.length) {
        return reply
          .code(400)
          .send({ error: "No supported media files found in folder" });
      }

      const chosenEncoder = pickEncoder(encoder ?? defaults.encoder);
      const chosenStreamSelection = pickStreamSelection(
        streamSelection ?? defaults.streamSelection,
      );
      if (streamMap !== undefined) {
        return reply.code(400).send({
          error:
            "streamMap is only supported for single-file jobs, not folder queueing",
        });
      }
      const chosenAudioMode = pickAudioMode(audioMode ?? defaults.audioMode);
      const chosenSubtitleMode = pickSubtitleMode(
        subtitleMode ?? defaults.subtitleMode,
      );

      const batchOptions: BatchOptions = {
        qp: effectiveQp,
        encoder: chosenEncoder,
        streamSelection: chosenStreamSelection,
        audioMode: chosenAudioMode,
        subtitleMode: chosenSubtitleMode,
        streamMatching: streamPrefs,
      };

      const batch = createBatch({
        name: pickBatchName(folderPath, batchName),
        sourcePath: folderPath.trim(),
        kind: "folder",
        options: batchOptions,
      });
      queueEvents.emit("event", { type: "batch-added", batch });

      const jobs = files.map((sourcePath) => {
        const autoStreamMap =
          chosenStreamSelection === "primary"
            ? pickPrimaryStreamMap(
                probeMediaStreams(path.join(MEDIA_DIR, sourcePath)),
                streamPrefs,
              )
            : undefined;

        return addJob(
          batch.id,
          sourcePath,
          effectiveQp,
          chosenEncoder,
          chosenStreamSelection,
          autoStreamMap,
          chosenAudioMode,
          chosenSubtitleMode,
        );
      });

      const updatedBatch = appendBatchJobs(
        batch.id,
        jobs.map((job) => job.id),
      );
      if (updatedBatch) {
        queueEvents.emit("event", {
          type: "batch-updated",
          batch: updatedBatch,
        });
      }

      return reply.code(201).send({
        queued: jobs.length,
        batchId: batch.id,
        firstJobId: jobs[0]?.id ?? null,
      });
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    "/api/jobs/:id",
    async (req, reply) => {
      const ok = cancelJob(req.params.id);
      if (!ok)
        return reply
          .code(404)
          .send({ error: "Job not found or already terminal" });
      return reply.code(204).send();
    },
  );
};

export default transcodeRoute;
