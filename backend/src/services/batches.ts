import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { BATCHES_FILE, CONFIG_DIR } from "../config.js";

export type EncoderChoice = "vaapi" | "videotoolbox" | "software";
export type StreamSelection = "all" | "primary";
export type AudioMode = "copy" | "aac";
export type SubtitleMode = "copy" | "drop";

export interface StreamMapSelection {
  videoIndex?: number;
  audioIndex?: number | null;
  subtitleIndex?: number | null;
}

export interface StreamMatchingSnapshot {
  audioLanguage: string;
  subtitleLanguage: string;
  preferDefaultAudio: boolean;
  preferDefaultSubtitle: boolean;
}

export interface BatchOptions {
  qp: number;
  encoder: EncoderChoice;
  streamSelection: StreamSelection;
  streamMap?: StreamMapSelection;
  audioMode: AudioMode;
  subtitleMode: SubtitleMode;
  streamMatching: StreamMatchingSnapshot;
}

export type BatchKind = "single" | "folder";

export interface Batch {
  id: string;
  name: string;
  sourcePath: string;
  kind: BatchKind;
  paused: boolean;
  createdAt: string;
  jobIds: string[];
  options: BatchOptions;
}

interface BatchesPayload {
  version: number;
  updatedAt: string;
  items: Batch[];
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 96) : "Batch";
}

function readRaw(): BatchesPayload {
  try {
    const raw = fs.readFileSync(BATCHES_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<BatchesPayload>;
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

function writeRaw(payload: BatchesPayload): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const tmp = BATCHES_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tmp, BATCHES_FILE);
}

export function listBatches(): Batch[] {
  const payload = readRaw();
  const normalized = payload.items.map((item) => ({
    ...item,
    paused: item.paused === true,
  }));
  return normalized.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function getBatch(batchId: string): Batch | null {
  const payload = readRaw();
  const found = payload.items.find((item) => item.id === batchId);
  if (!found) return null;
  return {
    ...found,
    paused: found.paused === true,
  };
}

export function createBatch(input: {
  name: string;
  sourcePath: string;
  kind: BatchKind;
  options: BatchOptions;
}): Batch {
  const payload = readRaw();

  const batch: Batch = {
    id: randomUUID(),
    name: normalizeName(input.name),
    sourcePath: input.sourcePath,
    kind: input.kind,
    paused: false,
    createdAt: new Date().toISOString(),
    jobIds: [],
    options: input.options,
  };

  payload.items.unshift(batch);
  if (payload.items.length > 2000) {
    payload.items.length = 2000;
  }

  payload.updatedAt = new Date().toISOString();
  writeRaw(payload);
  return batch;
}

export function appendBatchJobs(
  batchId: string,
  jobIds: string[],
): Batch | null {
  if (!jobIds.length) return null;

  const payload = readRaw();
  const index = payload.items.findIndex((item) => item.id === batchId);
  if (index < 0) return null;

  const item = payload.items[index]!;
  const merged = new Set(item.jobIds);
  for (const id of jobIds) merged.add(id);

  const next: Batch = {
    ...item,
    jobIds: [...merged],
  };

  payload.items[index] = next;
  payload.updatedAt = new Date().toISOString();
  writeRaw(payload);
  return next;
}

export function setBatchPaused(batchId: string, paused: boolean): Batch | null {
  const payload = readRaw();
  const index = payload.items.findIndex((item) => item.id === batchId);
  if (index < 0) return null;

  const current = payload.items[index]!;
  const next: Batch = {
    ...current,
    paused,
  };

  payload.items[index] = next;
  payload.updatedAt = new Date().toISOString();
  writeRaw(payload);
  return next;
}
