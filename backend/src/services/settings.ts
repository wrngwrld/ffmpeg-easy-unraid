import fs from "node:fs";
import { CONFIG_DIR, PARALLEL_JOBS, SETTINGS_FILE } from "../config.js";

const MIN_PARALLEL_JOBS = 1;
const MAX_PARALLEL_JOBS = 8;

type EncoderChoice = "vaapi" | "videotoolbox" | "software";
type StreamSelection = "all" | "primary";
type AudioMode = "copy" | "aac";
type SubtitleMode = "copy" | "drop";

export interface TranscodeDefaults {
  qp: number;
  encoder: EncoderChoice;
  streamSelection: StreamSelection;
  audioMode: AudioMode;
  subtitleMode: SubtitleMode;
}

export interface AppSettings {
  parallelJobs: number;
  defaultTranscode: TranscodeDefaults;
}

function clampParallelJobs(value: number): number {
  if (!Number.isFinite(value)) return MIN_PARALLEL_JOBS;
  return Math.max(
    MIN_PARALLEL_JOBS,
    Math.min(MAX_PARALLEL_JOBS, Math.floor(value)),
  );
}

function clampQp(value: number): number {
  if (!Number.isFinite(value)) return 22;
  return Math.max(0, Math.min(51, Math.floor(value)));
}

function pickEncoder(value: unknown): EncoderChoice {
  return value === "vaapi" || value === "videotoolbox" || value === "software"
    ? value
    : "vaapi";
}

function pickStreamSelection(value: unknown): StreamSelection {
  return value === "primary" ? "primary" : "all";
}

function pickAudioMode(value: unknown): AudioMode {
  return value === "aac" ? "aac" : "copy";
}

function pickSubtitleMode(value: unknown): SubtitleMode {
  return value === "drop" ? "drop" : "copy";
}

function normalizeDefaultTranscode(
  next: Partial<TranscodeDefaults> | undefined,
): TranscodeDefaults {
  return {
    qp: clampQp(next?.qp ?? 22),
    encoder: pickEncoder(next?.encoder),
    streamSelection: pickStreamSelection(next?.streamSelection),
    audioMode: pickAudioMode(next?.audioMode),
    subtitleMode: pickSubtitleMode(next?.subtitleMode),
  };
}

function defaultSettings(): AppSettings {
  return {
    parallelJobs: clampParallelJobs(PARALLEL_JOBS),
    defaultTranscode: normalizeDefaultTranscode(undefined),
  };
}

function readRaw(): AppSettings {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      parallelJobs: clampParallelJobs(parsed.parallelJobs ?? PARALLEL_JOBS),
      defaultTranscode: normalizeDefaultTranscode(parsed.defaultTranscode),
    };
  } catch {
    return defaultSettings();
  }
}

export function readSettings(): AppSettings {
  return readRaw();
}

export function writeSettings(next: AppSettings): AppSettings {
  const normalized: AppSettings = {
    parallelJobs: clampParallelJobs(next.parallelJobs),
    defaultTranscode: normalizeDefaultTranscode(next.defaultTranscode),
  };

  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const tmp = SETTINGS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2), "utf8");
  fs.renameSync(tmp, SETTINGS_FILE);

  return normalized;
}

export function getParallelJobsLimits(): { min: number; max: number } {
  return { min: MIN_PARALLEL_JOBS, max: MAX_PARALLEL_JOBS };
}
