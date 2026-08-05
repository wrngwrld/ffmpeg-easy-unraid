import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type {
  AppSettings,
  AppSettingsLimits,
  EncoderChoice,
  Job,
  TranscodeDefaults,
} from "../types.ts";

const DEFAULT_TRANSCODE_STORAGE_KEY = "transcode-harbor.defaultTranscode";

function normalizeDefaults(
  next: Partial<TranscodeDefaults> | undefined,
): TranscodeDefaults {
  const rawQp = next?.qp;
  const qp =
    typeof rawQp === "number" && Number.isFinite(rawQp)
      ? Math.max(0, Math.min(51, Math.floor(rawQp)))
      : 22;

  return {
    qp,
    encoder:
      next?.encoder === "vaapi" ||
      next?.encoder === "videotoolbox" ||
      next?.encoder === "software"
        ? next.encoder
        : "vaapi",
    streamSelection: next?.streamSelection === "primary" ? "primary" : "all",
    audioMode: next?.audioMode === "aac" ? "aac" : "copy",
    subtitleMode: next?.subtitleMode === "drop" ? "drop" : "copy",
  };
}

function loadLocalDefaults(): TranscodeDefaults | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DEFAULT_TRANSCODE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TranscodeDefaults>;
    return normalizeDefaults(parsed);
  } catch {
    return null;
  }
}

function saveLocalDefaults(next: TranscodeDefaults): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      DEFAULT_TRANSCODE_STORAGE_KEY,
      JSON.stringify(next),
    );
  } catch {
    /* ignore storage errors */
  }
}

export const useStatusStore = defineStore("status", () => {
  const localDefaults = loadLocalDefaults();

  const availableEncoders = ref<EncoderChoice[]>(["software"]);
  const hardwareAvailable = ref<boolean | null>(null);
  const connected = ref(false);
  const parallelJobs = ref(1);
  const defaultTranscode = ref<TranscodeDefaults>({
    ...(localDefaults ?? {
      qp: 22,
      encoder: "vaapi",
      streamSelection: "all",
      audioMode: "copy",
      subtitleMode: "copy",
    }),
  });
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

    if (settings?.defaultTranscode) {
      defaultTranscode.value = normalizeDefaults(settings.defaultTranscode);
      saveLocalDefaults(defaultTranscode.value);
    }
  }

  async function loadSettings(): Promise<void> {
    const res = await fetch("/api/settings");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = (await res.json()) as {
      settings?: AppSettings;
      defaults?: AppSettings;
      limits?: AppSettingsLimits;
    };

    applySettings(data.settings);
    applySettings(data.defaults);
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
      defaults?: AppSettings;
      limits?: AppSettingsLimits;
    };
    applySettings(data.settings);
    applySettings(data.defaults);
    if (data.limits) settingsLimits.value = data.limits;
  }

  async function updateDefaultTranscode(
    next: Partial<TranscodeDefaults>,
  ): Promise<void> {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parallelJobs: parallelJobs.value,
        defaultTranscode: next,
      }),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }

    // Keep defaults updated in UI even if an older backend response omits defaults.
    defaultTranscode.value = normalizeDefaults({
      ...defaultTranscode.value,
      ...next,
    });
    saveLocalDefaults(defaultTranscode.value);

    const data = (await res.json()) as {
      settings?: AppSettings;
      defaults?: AppSettings;
    };
    applySettings(data.settings);
    applySettings(data.defaults);
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
    defaultTranscode,
    settingsLimits,
    init,
    loadSettings,
    updateParallelJobs,
    updateDefaultTranscode,
  };
});
