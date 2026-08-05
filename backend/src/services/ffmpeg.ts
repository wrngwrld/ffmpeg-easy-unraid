import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { MEDIA_DIR, EXPORT_DIR } from "../config.js";

export interface HdrInfo {
  isHdr: boolean;
  transfer?: string;
  primaries?: string;
  colorspace?: string;
  colorRange?: string;
}

export type HardwareEncoder = "vaapi" | "videotoolbox";

let _availableHardwareEncoders: Set<HardwareEncoder> | null = null;

function probeVaapi(): boolean {
  const result = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-init_hw_device",
      "vaapi=va:/dev/dri/renderD128",
      "-filter_hw_device",
      "va",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=128x128",
      "-vf",
      "format=nv12,hwupload",
      "-frames:v",
      "1",
      "-c:v",
      "hevc_vaapi",
      "-qp",
      "22",
      "-f",
      "null",
      "-",
    ],
    { timeout: 15_000, stdio: "pipe" },
  );

  return result.status === 0;
}

function probeVideoToolbox(): boolean {
  const result = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=128x128",
      "-frames:v",
      "1",
      "-c:v",
      "hevc_videotoolbox",
      "-f",
      "null",
      "-",
    ],
    { timeout: 15_000, stdio: "pipe" },
  );

  return result.status === 0;
}

export async function probeHardware(): Promise<boolean> {
  if (_availableHardwareEncoders !== null) {
    return _availableHardwareEncoders.size > 0;
  }

  const detected = new Set<HardwareEncoder>();

  if (probeVaapi()) {
    detected.add("vaapi");
    console.log("[ffmpeg] Intel VAAPI hardware encoding available");
  }

  if (probeVideoToolbox()) {
    detected.add("videotoolbox");
    console.log("[ffmpeg] Apple VideoToolbox hardware encoding available");
  }

  _availableHardwareEncoders = detected;

  if (detected.size === 0) {
    console.warn(
      "[ffmpeg] No hardware encoder available — falling back to libx265 software encoding",
    );
  }

  return detected.size > 0;
}

export function isHardwareAvailable(): boolean {
  return (_availableHardwareEncoders?.size ?? 0) > 0;
}

export function isEncoderAvailable(encoder: HardwareEncoder): boolean {
  return _availableHardwareEncoders?.has(encoder) === true;
}

export function getAvailableEncoders(): Array<
  "software" | "vaapi" | "videotoolbox"
> {
  const encoders: Array<"software" | "vaapi" | "videotoolbox"> = ["software"];
  if (_availableHardwareEncoders?.has("vaapi")) encoders.unshift("vaapi");
  if (_availableHardwareEncoders?.has("videotoolbox")) {
    encoders.unshift("videotoolbox");
  }
  return encoders;
}

export function detectHdr(filePath: string): HdrInfo {
  const result = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=color_transfer,color_primaries,color_space,color_range",
      "-of",
      "csv=p=0",
      filePath,
    ],
    { timeout: 10_000, stdio: "pipe", encoding: "utf8" },
  );

  if (result.status !== 0) return { isHdr: false };

  const [transfer = "", primaries = "", colorspace = "", colorRange = ""] = (
    result.stdout ?? ""
  )
    .trim()
    .split(",");

  const isHdr = transfer === "smpte2084" || transfer === "arib-std-b67";

  return {
    isHdr,
    transfer: transfer || undefined,
    primaries: primaries || undefined,
    colorspace: colorspace || undefined,
    colorRange: colorRange && colorRange !== "unknown" ? colorRange : undefined,
  };
}

export function getFileDuration(filePath: string): number | null {
  const result = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ],
    { timeout: 10_000, stdio: "pipe", encoding: "utf8" },
  );

  const val = parseFloat((result.stdout ?? "").trim());
  return isNaN(val) ? null : val;
}

export interface SpawnOptions {
  id: string;
  sourcePath: string;
  outputPath: string;
  qp: number;
  encoder: "vaapi" | "videotoolbox" | "software";
  streamSelection: "all" | "primary";
  audioMode: "copy" | "aac";
  subtitleMode: "copy" | "drop";
  durationSeconds: number | null;
  onProgress: (pct: number, speed: string, elapsed: number) => void;
}

export interface TranscodeHandle {
  kill: () => void;
  done: Promise<void>;
}

export function spawnTranscode({
  sourcePath,
  outputPath,
  qp,
  encoder,
  streamSelection,
  audioMode,
  subtitleMode,
  durationSeconds,
  onProgress,
}: SpawnOptions): TranscodeHandle {
  const sourceAbs = path.join(MEDIA_DIR, sourcePath);
  const outputAbs = path.join(EXPORT_DIR, outputPath);
  const useVaapi = encoder === "vaapi" && isEncoderAvailable("vaapi");
  const useVideoToolbox =
    encoder === "videotoolbox" && isEncoderAvailable("videotoolbox");

  const args: string[] = [
    "-hide_banner",
    "-y",
    "-loglevel",
    "error",
    "-progress",
    "pipe:1",
  ];

  if (useVaapi) {
    args.push(
      "-init_hw_device",
      "vaapi=va:/dev/dri/renderD128",
      "-filter_hw_device",
      "va",
      "-vaapi_device",
      "/dev/dri/renderD128",
      "-hwaccel",
      "vaapi",
      "-hwaccel_output_format",
      "vaapi",
      "-hwaccel_device",
      "/dev/dri/renderD128",
    );
  }

  args.push("-i", sourceAbs);

  if (streamSelection === "primary") {
    args.push("-map", "0:v:0", "-map", "0:a:0?");
    if (subtitleMode === "copy") {
      args.push("-map", "0:s:0?");
    }
  } else {
    args.push("-map", "0");
  }

  if (useVaapi) {
    const hdr = detectHdr(sourceAbs);
    if (hdr.isHdr && hdr.transfer && hdr.primaries && hdr.colorspace) {
      args.push(
        "-vf",
        "scale_vaapi=format=p010le",
        "-c:v",
        "hevc_vaapi",
        "-profile:v",
        "main10",
        "-color_primaries",
        hdr.primaries,
        "-color_trc",
        hdr.transfer,
        "-colorspace",
        hdr.colorspace,
        "-qp",
        String(qp),
      );
    } else {
      args.push(
        "-vf",
        "scale_vaapi=format=nv12",
        "-c:v",
        "hevc_vaapi",
        "-qp",
        String(qp),
      );
    }
  } else if (useVideoToolbox) {
    // VideoToolbox quality scale differs from QP/CRF. Map 0-51 to 100-1.
    const vtQuality = Math.max(
      1,
      Math.min(100, 100 - Math.round((qp / 51) * 99)),
    );
    args.push(
      "-c:v",
      "hevc_videotoolbox",
      "-q:v",
      String(vtQuality),
      "-tag:v",
      "hvc1",
    );
  } else {
    args.push("-c:v", "libx265", "-preset", "medium", "-crf", String(qp));
  }

  args.push("-c:a", audioMode === "aac" ? "aac" : "copy");

  if (subtitleMode === "drop") {
    args.push("-sn");
  } else {
    args.push("-c:s", "copy");
  }

  args.push(outputAbs);

  const startMs = Date.now();
  const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });

  let buf = "";
  const fields: Record<string, string> = {};

  proc.stdout?.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";

    for (const line of lines) {
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      fields[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();

      if (fields.progress !== undefined && line.startsWith("progress=")) {
        const outTimeMs = parseInt(fields.out_time_ms ?? "0", 10);
        const speed = (fields.speed ?? "n/a").trim();
        const elapsed = Math.floor((Date.now() - startMs) / 1000);
        const pct =
          durationSeconds && durationSeconds > 0 && outTimeMs > 0
            ? Math.min(100, (outTimeMs / 1_000_000 / durationSeconds) * 100)
            : 0;
        onProgress(pct, speed, elapsed);
      }
    }
  });

  const done = new Promise<void>((resolve, reject) => {
    proc.on("close", (code) => {
      if (code === 0 || code === null) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });

  return {
    kill: () => proc.kill("SIGTERM"),
    done,
  };
}
