import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR, STATS_FILE } from "../config.js";

export interface StatsEntry {
  timestamp: string;
  relativePath: string;
  status: "succeeded" | "failed";
  method: string;
  qp: number;
  inputBytes: number;
  outputBytes: number;
  savedBytes: number;
  savedPercent: number;
}

export interface StatsTotals {
  processed: number;
  succeeded: number;
  failed: number;
  inputBytes: number;
  outputBytes: number;
  savedBytes: number;
  avgSavedPercent: number;
}

export interface StatsPayload {
  version: number;
  updatedAt: string;
  totals: StatsTotals;
  recentFiles: StatsEntry[];
}

const DEFAULT_TOTALS: StatsTotals = {
  processed: 0,
  succeeded: 0,
  failed: 0,
  inputBytes: 0,
  outputBytes: 0,
  savedBytes: 0,
  avgSavedPercent: 0,
};

function readRaw(): StatsPayload {
  try {
    const raw = fs.readFileSync(STATS_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<StatsPayload>;
    if (parsed && typeof parsed === "object") {
      return {
        version: 1,
        updatedAt: parsed.updatedAt ?? "",
        totals: { ...DEFAULT_TOTALS, ...(parsed.totals ?? {}) },
        recentFiles: Array.isArray(parsed.recentFiles)
          ? parsed.recentFiles
          : [],
      };
    }
  } catch {
    // file absent or corrupt — start fresh
  }
  return {
    version: 1,
    updatedAt: "",
    totals: { ...DEFAULT_TOTALS },
    recentFiles: [],
  };
}

export function readStats(): StatsPayload {
  return readRaw();
}

export function recordEntry(entry: StatsEntry): void {
  const payload = readRaw();
  const t = payload.totals;

  t.processed += 1;
  if (entry.status === "succeeded") {
    t.succeeded += 1;
    t.inputBytes += entry.inputBytes;
    t.outputBytes += entry.outputBytes;
    t.savedBytes = t.inputBytes - t.outputBytes;
    t.avgSavedPercent =
      t.inputBytes > 0 ? (t.savedBytes / t.inputBytes) * 100 : 0;
  } else {
    t.failed += 1;
  }

  payload.recentFiles.unshift(entry);
  if (payload.recentFiles.length > 5000) {
    payload.recentFiles.length = 5000;
  }

  payload.updatedAt = new Date().toISOString();

  // atomic write via temp file + rename
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const tmp = STATS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tmp, STATS_FILE);
}
