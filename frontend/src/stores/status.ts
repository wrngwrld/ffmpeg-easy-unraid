import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { EncoderChoice, Job } from "../types.ts";

export const useStatusStore = defineStore("status", () => {
  const availableEncoders = ref<EncoderChoice[]>(["software"]);
  const hardwareAvailable = ref<boolean | null>(null);
  const connected = ref(false);
  const jobMap = ref(new Map<string, Job>());

  const jobs = computed<Job[]>(() =>
    [...jobMap.value.values()].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    ),
  );

  function applyJob(job: Job): void {
    jobMap.value.set(job.id, job);
  }

  function init(): void {
    // load existing jobs on startup
    fetch("/api/jobs")
      .then((r) => r.json())
      .then((data: { jobs?: Job[]; availableEncoders?: EncoderChoice[] }) => {
        (data.jobs ?? []).forEach(applyJob);
        if (Array.isArray(data.availableEncoders)) {
          availableEncoders.value = data.availableEncoders;
          hardwareAvailable.value = data.availableEncoders.some(
            (e) => e !== "software",
          );
        }
      })
      .catch(() => {});

    const source = new EventSource("/api/events");

    source.addEventListener("status", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as {
        availableEncoders?: EncoderChoice[];
      };
      if (Array.isArray(d.availableEncoders)) {
        availableEncoders.value = d.availableEncoders;
        hardwareAvailable.value = d.availableEncoders.some(
          (enc) => enc !== "software",
        );
      }
    });

    const jobEvents = [
      "job-added",
      "job-progress",
      "job-done",
      "job-failed",
      "job-cancelled",
    ];
    for (const evt of jobEvents) {
      source.addEventListener(evt, (e) => {
        applyJob(JSON.parse((e as MessageEvent).data) as Job);
      });
    }

    source.addEventListener("open", () => {
      connected.value = true;
    });
    source.addEventListener("error", () => {
      connected.value = false;
    });
  }

  return { availableEncoders, hardwareAvailable, connected, jobs, init };
});
