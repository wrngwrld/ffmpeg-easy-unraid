import { defineStore } from "pinia";
import { computed } from "vue";
import { useStatusStore } from "./status.ts";
import type {
  AudioMode,
  Batch,
  EncoderChoice,
  StreamMapSelection,
  StreamSelection,
  SubtitleMode,
} from "../types.ts";

type QueueConflictReason = "exists" | "active";

interface QueueConflictItem {
  sourcePath: string;
  outputPath: string;
  reason: QueueConflictReason;
}

export interface QueueApiErrorBody {
  error?: string;
  reason?: QueueConflictReason;
  outputPath?: string;
  conflictCount?: number;
  conflicts?: QueueConflictItem[];
}

export class QueueRequestError extends Error {
  status: number;
  body: QueueApiErrorBody;

  constructor(status: number, body: QueueApiErrorBody) {
    super(body.error ?? `HTTP ${status}`);
    this.name = "QueueRequestError";
    this.status = status;
    this.body = body;
  }
}

async function throwQueueError(res: Response): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as QueueApiErrorBody;
  throw new QueueRequestError(res.status, body);
}

export const useQueueStore = defineStore("queue", () => {
  const status = useStatusStore();

  const toMs = (iso: string | null | undefined): number => {
    if (!iso) return 0;
    const ms = new Date(iso).getTime();
    return Number.isFinite(ms) ? ms : 0;
  };

  const byCreatedAsc = (a: { createdAt: string }, b: { createdAt: string }) =>
    toMs(a.createdAt) - toMs(b.createdAt);

  const activeJobs = computed(() =>
    status.jobs
      .filter((j) => j.state === "running" || j.state === "queued")
      .sort((a, b) => {
        const rank = (state: string): number =>
          state === "running" ? 0 : state === "queued" ? 1 : 2;
        const rankDiff = rank(a.state) - rank(b.state);
        if (rankDiff !== 0) return rankDiff;
        return byCreatedAsc(a, b);
      }),
  );

  const queuedJobs = computed(() =>
    status.jobs.filter((j) => j.state === "queued").sort(byCreatedAsc),
  );

  const completedJobs = computed(() =>
    status.jobs
      .filter(
        (j) =>
          j.state === "done" || j.state === "failed" || j.state === "cancelled",
      )
      .sort((a, b) => {
        const byFinished = toMs(b.finishedAt) - toMs(a.finishedAt);
        if (byFinished !== 0) return byFinished;
        return toMs(b.createdAt) - toMs(a.createdAt);
      }),
  );

  async function submit(
    sourcePath: string,
    qp: number,
    encoder: EncoderChoice,
    streamSelection: StreamSelection,
    streamMap: StreamMapSelection | undefined,
    audioMode: AudioMode,
    subtitleMode: SubtitleMode,
    batchName?: string,
    overwriteExisting?: boolean,
  ): Promise<void> {
    const res = await fetch("/api/transcode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourcePath,
        qp,
        encoder,
        streamSelection,
        streamMap,
        audioMode,
        subtitleMode,
        batchName,
        overwriteExisting,
      }),
    });
    if (!res.ok) {
      await throwQueueError(res);
    }
  }

  async function submitFolder(
    folderPath: string,
    qp: number,
    encoder: EncoderChoice,
    streamSelection: StreamSelection,
    audioMode: AudioMode,
    subtitleMode: SubtitleMode,
    batchName?: string,
    overwriteExisting?: boolean,
  ): Promise<number> {
    const res = await fetch("/api/transcode/folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folderPath,
        qp,
        encoder,
        streamSelection,
        audioMode,
        subtitleMode,
        batchName,
        overwriteExisting,
      }),
    });
    if (!res.ok) {
      await throwQueueError(res);
    }
    const payload = (await res.json()) as { queued?: number };
    return payload.queued ?? 0;
  }

  async function submitFiles(
    sourcePaths: string[],
    qp: number,
    encoder: EncoderChoice,
    streamSelection: StreamSelection,
    audioMode: AudioMode,
    subtitleMode: SubtitleMode,
    batchName?: string,
    overwriteExisting?: boolean,
  ): Promise<number> {
    const res = await fetch("/api/transcode/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourcePaths,
        qp,
        encoder,
        streamSelection,
        audioMode,
        subtitleMode,
        batchName,
        overwriteExisting,
      }),
    });
    if (!res.ok) {
      await throwQueueError(res);
    }
    const payload = (await res.json()) as { queued?: number };
    return payload.queued ?? 0;
  }

  async function cancel(id: string): Promise<void> {
    await fetch(`/api/jobs/${id}`, { method: "DELETE" });
  }

  async function pauseBatch(batchId: string): Promise<void> {
    const res = await fetch(
      `/api/batches/${encodeURIComponent(batchId)}/pause`,
      {
        method: "POST",
      },
    );
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }

    const data = (await res.json()) as { batch?: Batch };
    if (data.batch) {
      status.upsertBatch(data.batch);
    }
    await status.refreshQueueSnapshot();
  }

  async function resumeBatch(batchId: string): Promise<void> {
    const res = await fetch(
      `/api/batches/${encodeURIComponent(batchId)}/resume`,
      {
        method: "POST",
      },
    );
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }

    const data = (await res.json()) as { batch?: Batch };
    if (data.batch) {
      status.upsertBatch(data.batch);
    }
    await status.refreshQueueSnapshot();
  }

  async function cancelRemainingInBatch(batchId: string): Promise<number> {
    const res = await fetch(
      `/api/batches/${encodeURIComponent(batchId)}/cancel-remaining`,
      { method: "POST" },
    );
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    const payload = (await res.json()) as { cancelled?: number };
    await status.refreshQueueSnapshot();
    return payload.cancelled ?? 0;
  }

  return {
    activeJobs,
    queuedJobs,
    completedJobs,
    submit,
    submitFolder,
    submitFiles,
    cancel,
    pauseBatch,
    resumeBatch,
    cancelRemainingInBatch,
  };
});
