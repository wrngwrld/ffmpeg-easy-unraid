import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { APPROVALS_FILE, CONFIG_DIR } from "../config.js";

export interface ApprovalItem {
  id: string;
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

function readRaw(): ApprovalsPayload {
  try {
    const raw = fs.readFileSync(APPROVALS_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<ApprovalsPayload>;
    return {
      version: 1,
      updatedAt: parsed.updatedAt ?? "",
      pending: Array.isArray(parsed.pending) ? parsed.pending : [],
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
