import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type {
  AppSettings,
  AppSettingsLimits,
  EncoderChoice,
  Job,
} from "../types.ts";

export const useStatusStore = defineStore("status", () => {
  const availableEncoders = ref<EncoderChoice[]>(["software"]);
  const hardwareAvailable = ref<boolean | null>(null);
  const connected = ref(false);
  const parallelJobs = ref(1);
  const settingsLimits = ref<AppSettingsLimits>({ min: 1, max: 8 });
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

  function applySettings(settings: Partial<AppSettings> | undefined): void {
    if (typeof settings?.parallelJobs === "number") {
      parallelJobs.value = settings.parallelJobs;
    }
  }

  async function loadSettings(): Promise<void> {
    const res = await fetch("/api/settings");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = (await res.json()) as {
      settings?: AppSettings;
      limits?: AppSettingsLimits;
    };

    applySettings(data.settings);
    if (data.limits) settingsLimits.value = data.limits;
  }

  async function updateParallelJobs(value: number): Promise<void> {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parallelJobs: value }),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      settings?: AppSettings;
      limits?: AppSettingsLimits;
    };
    applySettings(data.settings);
    if (data.limits) settingsLimits.value = data.limits;
  }

  function init(): void {
    // load existing jobs on startup
    fetch("/api/jobs")
      .then((r) => r.json())
      .then(
        (data: {
          jobs?: Job[];
          availableEncoders?: EncoderChoice[];
          parallelJobs?: number;
        }) => {
          (data.jobs ?? []).forEach(applyJob);
          if (Array.isArray(data.availableEncoders)) {
            availableEncoders.value = data.availableEncoders;
            hardwareAvailable.value = data.availableEncoders.some(
              (e) => e !== "software",
            );
          }
          if (typeof data.parallelJobs === "number") {
            parallelJobs.value = data.parallelJobs;
          }
        },
      )
      .catch(() => {});

    void loadSettings().catch(() => {});

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

    source.addEventListener("settings-updated", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as {
        parallelJobs?: number;
      };
      if (typeof d.parallelJobs === "number") {
        parallelJobs.value = d.parallelJobs;
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

  return {
    availableEncoders,
    hardwareAvailable,
    connected,
    jobs,
    parallelJobs,
    settingsLimits,
    init,
    loadSettings,
    updateParallelJobs,
  };
});
