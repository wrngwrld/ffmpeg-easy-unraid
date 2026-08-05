import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fs from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { MEDIA_DIR, EXPORT_DIR, CONFIG_DIR } from "../config.js";

const previewBuilds = new Map<string, Promise<void>>();

const MIME: Record<string, string> = {
  ".mkv": "video/x-matroska",
  ".mp4": "video/mp4",
  ".ts": "video/mp2t",
  ".m2ts": "video/mp2t",
  ".avi": "video/x-msvideo",
  ".mov": "video/quicktime",
  ".wmv": "video/x-ms-wmv",
};

function safePath(base: string, reqPath: string): string | null {
  const rel = path.normalize(reqPath ?? "").replace(/^[/\\]+/, "");
  const abs = path.resolve(base, rel);
  if (!abs.startsWith(path.resolve(base))) return null;
  return abs;
}

function streamVideo(
  filePath: string,
  req: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  let st: fs.Stats;
  try {
    st = fs.statSync(filePath);
  } catch {
    return reply.code(404).send({ error: "File not found" });
  }

  const total = st.size;
  const mime =
    MIME[path.extname(filePath).toLowerCase()] ?? "video/octet-stream";
  const rawRange = req.headers.range;
  const rangeHeader = Array.isArray(rawRange) ? rawRange[0] : rawRange;
  const hasMultiRange = rangeHeader?.includes(",") === true;
  const range = rangeHeader?.split(",")[0]?.trim();

  if (hasMultiRange) {
    return reply
      .code(200)
      .header("Content-Type", mime)
      .header("Accept-Ranges", "bytes")
      .header("Content-Length", String(total))
      .send(fs.createReadStream(filePath));
  }

  if (range) {
    // Support RFC7233 single-byte-range forms:
    // - bytes=START-END
    // - bytes=START-
    // - bytes=-SUFFIX_LENGTH
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match || (match[1] === "" && match[2] === "")) {
      return reply.code(416).header("Content-Range", `bytes */${total}`).send();
    }

    let start = 0;
    let end = total - 1;

    if (match[1] !== "") {
      start = parseInt(match[1], 10);
      end = match[2] !== "" ? parseInt(match[2], 10) : total - 1;
    } else {
      // Suffix range: last N bytes (e.g. bytes=-65536)
      const suffixLen = parseInt(match[2], 10);
      if (!Number.isFinite(suffixLen) || suffixLen <= 0) {
        return reply
          .code(416)
          .header("Content-Range", `bytes */${total}`)
          .send();
      }
      const n = Math.min(suffixLen, total);
      start = Math.max(0, total - n);
      end = total - 1;
    }

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return reply.code(416).header("Content-Range", `bytes */${total}`).send();
    }

    if (start >= total || end < start) {
      return reply.code(416).header("Content-Range", `bytes */${total}`).send();
    }

    if (end >= total) end = total - 1;

    return reply
      .code(206)
      .header("Content-Type", mime)
      .header("Content-Range", `bytes ${start}-${end}/${total}`)
      .header("Accept-Ranges", "bytes")
      .header("Content-Length", String(end - start + 1))
      .send(fs.createReadStream(filePath, { start, end }));
  } else {
    return reply
      .code(200)
      .header("Content-Type", mime)
      .header("Accept-Ranges", "bytes")
      .header("Content-Length", String(total))
      .send(fs.createReadStream(filePath));
  }
}

function makePreviewPath(inputPath: string): string {
  const key = createHash("sha1").update(inputPath).digest("hex");
  return path.join(CONFIG_DIR, "preview-cache", `${key}.mp4`);
}

async function ensurePreview(inputPath: string): Promise<string> {
  const outputPath = makePreviewPath(inputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });

  const [srcStat, outStat] = await Promise.all([
    stat(inputPath),
    stat(outputPath).catch(() => null),
  ]);

  if (outStat && outStat.size > 0 && outStat.mtimeMs >= srcStat.mtimeMs) {
    return outputPath;
  }

  const existingBuild = previewBuilds.get(outputPath);
  if (existingBuild) {
    await existingBuild;
    return outputPath;
  }

  const buildPromise = (async () => {
    const tempPath = `${outputPath}.tmp-${process.pid}-${Date.now()}.mp4`;

    try {
      // Fast path: keep original video codec when possible (e.g. HEVC on modern Chrome/macOS)
      // and only re-encode audio for browser compatibility.
      const remuxResult = await runFfmpegPreview(inputPath, tempPath, {
        copyVideo: true,
      });

      if (!remuxResult.ok) {
        // Fallback path: force browser-safe H.264 + AAC.
        const transcodeResult = await runFfmpegPreview(inputPath, tempPath, {
          copyVideo: false,
        });
        if (!transcodeResult.ok) {
          throw new Error(transcodeResult.error);
        }
      }

      await rename(tempPath, outputPath);
    } finally {
      await rm(tempPath, { force: true }).catch(() => {});
    }
  })();

  previewBuilds.set(outputPath, buildPromise);

  try {
    await buildPromise;
  } finally {
    previewBuilds.delete(outputPath);
  }

  return outputPath;
}

async function runFfmpegPreview(
  inputPath: string,
  outputPath: string,
  opts: { copyVideo: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const args = [
      "-hide_banner",
      "-y",
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      ...(opts.copyVideo
        ? ["-c:v", "copy", "-tag:v", "hvc1"]
        : [
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
          ]),
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      outputPath,
    ];

    const ff = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });

    let stderr = "";
    ff.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });

    ff.on("error", (err) => {
      resolve({ ok: false, error: String(err) });
    });
    ff.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true });
      } else {
        resolve({
          ok: false,
          error: `ffmpeg preview transcode failed with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`,
        });
      }
    });
  });
}

const streamRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { path?: string } }>(
    "/api/stream/source",
    async (req, reply) => {
      const abs = safePath(MEDIA_DIR, req.query.path ?? "");
      if (!abs) return reply.code(400).send({ error: "Invalid path" });
      return streamVideo(abs, req, reply);
    },
  );

  fastify.get<{ Querystring: { path?: string } }>(
    "/api/stream/output",
    async (req, reply) => {
      const abs = safePath(EXPORT_DIR, req.query.path ?? "");
      if (!abs) return reply.code(400).send({ error: "Invalid path" });
      return streamVideo(abs, req, reply);
    },
  );

  fastify.get<{ Querystring: { path?: string } }>(
    "/api/stream/preview/source",
    async (req, reply) => {
      const abs = safePath(MEDIA_DIR, req.query.path ?? "");
      if (!abs) return reply.code(400).send({ error: "Invalid path" });

      try {
        const previewPath = await ensurePreview(abs);
        return streamVideo(previewPath, req, reply);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({
          error: "Failed to generate browser preview",
          detail: message,
        });
      }
    },
  );

  fastify.get<{ Querystring: { path?: string } }>(
    "/api/stream/preview/output",
    async (req, reply) => {
      const abs = safePath(EXPORT_DIR, req.query.path ?? "");
      if (!abs) return reply.code(400).send({ error: "Invalid path" });

      try {
        const previewPath = await ensurePreview(abs);
        return streamVideo(previewPath, req, reply);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({
          error: "Failed to generate browser preview",
          detail: message,
        });
      }
    },
  );
};

export default streamRoute;
