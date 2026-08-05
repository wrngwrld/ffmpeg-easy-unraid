import type { FastifyPluginAsync } from "fastify";
import fs from "node:fs";
import path from "node:path";
import {
  addJob,
  cancelJob,
  getJobs,
  getParallelJobs,
} from "../services/jobQueue.js";
import { getAvailableEncoders } from "../services/ffmpeg.js";
import type {
  AudioMode,
  EncoderChoice,
  StreamSelection,
  SubtitleMode,
} from "../services/jobQueue.js";
import { MEDIA_DIR, MEDIA_EXTENSIONS } from "../config.js";
import { readSettings } from "../services/settings.js";

interface TranscodeBody {
  sourcePath: string;
  qp?: number;
  encoder?: string;
  streamSelection?: string;
  audioMode?: string;
  subtitleMode?: string;
}

interface TranscodeFolderBody {
  folderPath: string;
  qp?: number;
  encoder?: string;
  streamSelection?: string;
  audioMode?: string;
  subtitleMode?: string;
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
  fastify.get("/api/jobs", async () => ({
    jobs: getJobs(),
    availableEncoders: getAvailableEncoders(),
    parallelJobs: getParallelJobs(),
  }));

  fastify.post<{ Body: TranscodeBody }>(
    "/api/transcode",
    async (req, reply) => {
      const {
        sourcePath,
        qp,
        encoder,
        streamSelection,
        audioMode,
        subtitleMode,
      } = req.body ?? {};
      const defaults = readSettings().defaultTranscode;

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
      const chosenAudioMode = pickAudioMode(audioMode ?? defaults.audioMode);
      const chosenSubtitleMode = pickSubtitleMode(
        subtitleMode ?? defaults.subtitleMode,
      );

      const job = addJob(
        sourcePath.trim(),
        effectiveQp,
        chosenEncoder,
        chosenStreamSelection,
        chosenAudioMode,
        chosenSubtitleMode,
      );
      return reply.code(201).send({ jobId: job.id, job });
    },
  );

  fastify.post<{ Body: TranscodeFolderBody }>(
    "/api/transcode/folder",
    async (req, reply) => {
      const {
        folderPath,
        qp,
        encoder,
        streamSelection,
        audioMode,
        subtitleMode,
      } = req.body ?? {};
      const defaults = readSettings().defaultTranscode;

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
      const chosenAudioMode = pickAudioMode(audioMode ?? defaults.audioMode);
      const chosenSubtitleMode = pickSubtitleMode(
        subtitleMode ?? defaults.subtitleMode,
      );
      const jobs = files.map((sourcePath) =>
        addJob(
          sourcePath,
          effectiveQp,
          chosenEncoder,
          chosenStreamSelection,
          chosenAudioMode,
          chosenSubtitleMode,
        ),
      );

      return reply
        .code(201)
        .send({ queued: jobs.length, firstJobId: jobs[0]?.id ?? null });
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
