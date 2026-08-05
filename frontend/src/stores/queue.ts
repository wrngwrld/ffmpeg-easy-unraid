import { defineStore } from "pinia";
import { computed } from "vue";
import { useStatusStore } from "./status.ts";
import type {
  AudioMode,
  EncoderChoice,
  StreamSelection,
  SubtitleMode,
} from "../types.ts";

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
    audioMode: AudioMode,
    subtitleMode: SubtitleMode,
  ): Promise<void> {
    const res = await fetch("/api/transcode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourcePath,
        qp,
        encoder,
        streamSelection,
        audioMode,
        subtitleMode,
      }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
  }

  async function submitFolder(
    folderPath: string,
    qp: number,
    encoder: EncoderChoice,
    streamSelection: StreamSelection,
    audioMode: AudioMode,
    subtitleMode: SubtitleMode,
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
      }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    const payload = (await res.json()) as { queued?: number };
    return payload.queued ?? 0;
  }

  async function cancel(id: string): Promise<void> {
    await fetch(`/api/jobs/${id}`, { method: "DELETE" });
  }

  return {
    activeJobs,
    queuedJobs,
    completedJobs,
    submit,
    submitFolder,
    cancel,
  };
});
