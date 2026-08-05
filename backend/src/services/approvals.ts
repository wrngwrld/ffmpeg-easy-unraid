import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { APPROVALS_FILE, CONFIG_DIR } from "../config.js";

export interface ApprovalItem {
  id: string;
  batchId: string | null;
  batchName: string | null;
  sourcePath: string;
  outputPath: string;
  createdAt: string;
  completedAt: string;
  qp: number;
  encoder: "vaapi" | "videotoolbox" | "software";
  inputBytes: number | null;
  outputBytes: number | null;
  savedPercent: number | null;
}

interface ApprovalsPayload {
  version: number;
  updatedAt: string;
  pending: ApprovalItem[];
}

function normalizeApprovalItem(
  item: Partial<ApprovalItem>,
): ApprovalItem | null {
  if (!item || typeof item !== "object") return null;
  if (typeof item.id !== "string") return null;
  if (typeof item.sourcePath !== "string") return null;
  if (typeof item.outputPath !== "string") return null;
  if (typeof item.createdAt !== "string") return null;
  if (typeof item.completedAt !== "string") return null;
  if (typeof item.qp !== "number") return null;
  if (
    item.encoder !== "vaapi" &&
    item.encoder !== "videotoolbox" &&
    item.encoder !== "software"
  ) {
    return null;
  }

  return {
    id: item.id,
    batchId: typeof item.batchId === "string" ? item.batchId : null,
    batchName: typeof item.batchName === "string" ? item.batchName : null,
    sourcePath: item.sourcePath,
    outputPath: item.outputPath,
    createdAt: item.createdAt,
    completedAt: item.completedAt,
    qp: item.qp,
    encoder: item.encoder,
    inputBytes: typeof item.inputBytes === "number" ? item.inputBytes : null,
    outputBytes: typeof item.outputBytes === "number" ? item.outputBytes : null,
    savedPercent:
      typeof item.savedPercent === "number" ? item.savedPercent : null,
  };
}

function readRaw(): ApprovalsPayload {
  try {
    const raw = fs.readFileSync(APPROVALS_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<ApprovalsPayload>;
    return {
      version: 1,
      updatedAt: parsed.updatedAt ?? "",
      pending: Array.isArray(parsed.pending)
        ? parsed.pending
            .map((item) => normalizeApprovalItem(item))
            .filter((item): item is ApprovalItem => item !== null)
        : [],
    };
  } catch {
    return {
      version: 1,
      updatedAt: "",
      pending: [],
    };
  }
}

function writeRaw(payload: ApprovalsPayload): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const tmp = APPROVALS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tmp, APPROVALS_FILE);
}

export function listApprovals(): ApprovalItem[] {
  return readRaw().pending.sort(
    (a, b) =>
      new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime(),
  );
}

export function getApproval(id: string): ApprovalItem | null {
  return readRaw().pending.find((item) => item.id === id) ?? null;
}

export function upsertApproval(item: Omit<ApprovalItem, "id">): ApprovalItem {
  const payload = readRaw();

  const idx = payload.pending.findIndex(
    (p) => p.sourcePath === item.sourcePath,
  );
  const next: ApprovalItem = {
    id: idx >= 0 ? payload.pending[idx]!.id : randomUUID(),
    ...item,
  };

  if (idx >= 0) {
    payload.pending[idx] = next;
  } else {
    payload.pending.unshift(next);
  }

  payload.updatedAt = new Date().toISOString();
  writeRaw(payload);
  return next;
}

export function removeApproval(id: string): boolean {
  const payload = readRaw();
  const before = payload.pending.length;
  payload.pending = payload.pending.filter((item) => item.id !== id);
  if (payload.pending.length === before) return false;
  payload.updatedAt = new Date().toISOString();
  writeRaw(payload);
  return true;
}

export function removeApprovals(ids: string[]): number {
  const payload = readRaw();
  const idSet = new Set(ids);
  const before = payload.pending.length;
  payload.pending = payload.pending.filter((item) => !idSet.has(item.id));
  const removed = before - payload.pending.length;
  if (removed > 0) {
    payload.updatedAt = new Date().toISOString();
    writeRaw(payload);
  }
  return removed;
}
