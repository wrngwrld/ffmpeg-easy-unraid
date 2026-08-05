import fs from "node:fs";
import { CONFIG_DIR, PARALLEL_JOBS, SETTINGS_FILE } from "../config.js";

const MIN_PARALLEL_JOBS = 1;
const MAX_PARALLEL_JOBS = 8;

export interface AppSettings {
  parallelJobs: number;
}

function clampParallelJobs(value: number): number {
  if (!Number.isFinite(value)) return MIN_PARALLEL_JOBS;
  return Math.max(
    MIN_PARALLEL_JOBS,
    Math.min(MAX_PARALLEL_JOBS, Math.floor(value)),
  );
}

function defaultSettings(): AppSettings {
  return {
    parallelJobs: clampParallelJobs(PARALLEL_JOBS),
  };
}

function readRaw(): AppSettings {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      parallelJobs: clampParallelJobs(parsed.parallelJobs ?? PARALLEL_JOBS),
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
