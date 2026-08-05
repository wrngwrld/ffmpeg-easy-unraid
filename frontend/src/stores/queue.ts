import { defineStore } from "pinia";
import { computed } from "vue";
import { useStatusStore } from "./status.ts";
import type { EncoderChoice } from "../types.ts";

export const useQueueStore = defineStore("queue", () => {
  const status = useStatusStore();

  const activeJobs = computed(() =>
    status.jobs.filter((j) => j.state === "running" || j.state === "queued"),
  );

  const completedJobs = computed(() =>
    status.jobs.filter(
      (j) =>
        j.state === "done" || j.state === "failed" || j.state === "cancelled",
    ),
  );

  async function submit(
    sourcePath: string,
    qp: number,
    encoder: EncoderChoice,
  ): Promise<void> {
    const res = await fetch("/api/transcode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourcePath, qp, encoder }),
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
  ): Promise<number> {
    const res = await fetch("/api/transcode/folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderPath, qp, encoder }),
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

  return { activeJobs, completedJobs, submit, submitFolder, cancel };
});
