<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { QueueRequestError, useQueueStore } from "../stores/queue.ts";
import { useStatusStore } from "../stores/status.ts";
import type {
  AudioMode,
  EncoderChoice,
  StreamSelection,
  SubtitleMode,
} from "../types.ts";

const props = defineProps<{
  paths: string[];
  basePath: string;
}>();

const emit = defineEmits<{
  close: [];
  submitted: [queued: number];
}>();

const queue = useQueueStore();
const status = useStatusStore();

const qp = ref(status.defaultTranscode.qp);
const encoder = ref<EncoderChoice>(status.defaultTranscode.encoder);
const streamSelection = ref<StreamSelection>(
  status.defaultTranscode.streamSelection,
);
const audioMode = ref<AudioMode>(status.defaultTranscode.audioMode);
const subtitleMode = ref<SubtitleMode>(status.defaultTranscode.subtitleMode);
const batchName = ref("");
const submitting = ref(false);
const errorMsg = ref<string | null>(null);
const successMsg = ref<string | null>(null);

const overwritePromptOpen = ref(false);
const overwritePromptText = ref("");
const overwritePromptCount = ref(0);
const overwritePromptExamples = ref<string[]>([]);
let overwritePromptResolver: ((answer: boolean) => void) | null = null;

const canVaapi = computed(() => status.availableEncoders.includes("vaapi"));
const canVideoToolbox = computed(() =>
  status.availableEncoders.includes("videotoolbox"),
);
const pathSamples = computed(() => props.paths.slice(0, 6));

watch(
  () => [status.availableEncoders, status.defaultTranscode] as const,
  ([available]) => {
    qp.value = status.defaultTranscode.qp;
    streamSelection.value = status.defaultTranscode.streamSelection;
    audioMode.value = status.defaultTranscode.audioMode;
    subtitleMode.value = status.defaultTranscode.subtitleMode;

    const preferred = status.defaultTranscode.encoder;
    if (available.includes(preferred)) {
      encoder.value = preferred;
      return;
    }
    if (available.includes("vaapi")) {
      encoder.value = "vaapi";
      return;
    }
    if (available.includes("videotoolbox")) {
      encoder.value = "videotoolbox";
      return;
    }
    encoder.value = "software";
  },
  { immediate: true },
);

watch(
  () => props.basePath,
  (next) => {
    batchName.value = `${next.replace(/^\//, "") || "root"} selection`;
  },
  { immediate: true },
);

async function askOverwriteConfirmation(
  message: string,
  existingCount: number,
  examples: string[],
): Promise<boolean> {
  overwritePromptText.value = message;
  overwritePromptCount.value = existingCount;
  overwritePromptExamples.value = examples;
  overwritePromptOpen.value = true;

  return new Promise<boolean>((resolve) => {
    overwritePromptResolver = resolve;
  });
}

function confirmOverwritePrompt(): void {
  overwritePromptOpen.value = false;
  overwritePromptText.value = "";
  overwritePromptCount.value = 0;
  overwritePromptExamples.value = [];
  overwritePromptResolver?.(true);
  overwritePromptResolver = null;
}

function cancelOverwritePrompt(): void {
  overwritePromptOpen.value = false;
  overwritePromptText.value = "";
  overwritePromptCount.value = 0;
  overwritePromptExamples.value = [];
  overwritePromptResolver?.(false);
  overwritePromptResolver = null;
}

async function submit(): Promise<void> {
  submitting.value = true;
  errorMsg.value = null;
  successMsg.value = null;

  try {
    const extractConflictCounts = (
      err: QueueRequestError,
    ): { existing: number; active: number } => {
      if (err.body.reason) {
        return {
          existing: err.body.reason === "exists" ? 1 : 0,
          active: err.body.reason === "active" ? 1 : 0,
        };
      }

      const conflicts = err.body.conflicts ?? [];
      let existing = 0;
      let active = 0;
      for (const item of conflicts) {
        if (item.reason === "exists") existing += 1;
        if (item.reason === "active") active += 1;
      }
      return { existing, active };
    };

    const extractExistingOutputs = (err: QueueRequestError): string[] => {
      if (err.body.outputPath && err.body.reason === "exists") {
        return [err.body.outputPath];
      }

      const fromList = (err.body.conflicts ?? [])
        .filter((item) => item.reason === "exists")
        .map((item) => item.outputPath);

      return [...new Set(fromList)].slice(0, 6);
    };

    const runSubmit = async (overwriteExisting: boolean): Promise<number> =>
      queue.submitFiles(
        props.paths,
        qp.value,
        encoder.value,
        streamSelection.value,
        audioMode.value,
        subtitleMode.value,
        batchName.value.trim() || undefined,
        overwriteExisting,
      );

    let queued: number;
    try {
      queued = await runSubmit(false);
    } catch (err) {
      if (!(err instanceof QueueRequestError) || err.status !== 409) {
        throw err;
      }

      const { existing, active } = extractConflictCounts(err);
      if (active > 0) {
        throw new Error(
          "Cannot queue because one or more outputs are already targeted by running/queued jobs.",
        );
      }

      if (existing <= 0) {
        throw err;
      }

      const ok = await askOverwriteConfirmation(
        `${existing} output file${existing === 1 ? "" : "s"} already exist. Overwrite and queue this selection?`,
        existing,
        extractExistingOutputs(err),
      );
      if (!ok) return;

      queued = await runSubmit(true);
    }

    successMsg.value = `Queued ${queued} file${queued === 1 ? "" : "s"}.`;
    emit("submitted", queued);
    emit("close");
  } catch (err) {
    errorMsg.value =
      err instanceof Error ? err.message : "Failed to queue selection";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div
    class="fixed inset-0 z-[220] flex items-center justify-center overflow-y-auto bg-black/65 p-6 backdrop-blur-[6px]"
    @click.self="$emit('close')"
  >
    <div
      class="relative max-h-[calc(100vh-3rem)] w-[min(560px,100%)] overflow-y-auto rounded-[28px] border border-[var(--border)] bg-[var(--glass-strong)] p-8 shadow-[var(--shadow-deep)] backdrop-blur-[24px] max-[760px]:p-[22px]"
    >
      <header class="mb-6">
        <div
          class="mb-3 inline-flex items-center gap-2 rounded-full border border-[rgba(109,212,236,0.22)] bg-[rgba(109,212,236,0.1)] px-3.5 py-1.5 text-[0.72rem] font-extrabold uppercase tracking-[0.12em] text-[var(--accent)]"
        >
          <span
            class="h-[7px] w-[7px] rounded-full bg-[var(--accent)] shadow-[0_0_18px_rgba(109,212,236,0.6)]"
          ></span
          >Selection
        </div>
        <h2 class="m-0 text-[1.6rem] font-black tracking-[-0.04em]">
          Queue Selected Files
        </h2>
      </header>

      <div
        class="mb-6 rounded-[14px] border border-white/10 bg-white/[0.04] px-4 py-3.5"
      >
        <p class="m-0 text-[0.86rem] text-[var(--text-muted)]">
          {{ paths.length }} file{{ paths.length === 1 ? "" : "s" }} selected
          from {{ basePath }}
        </p>
        <ul
          class="mb-0 mt-2 list-disc space-y-1 pl-5 text-[0.8rem] text-[var(--text-dim)]"
        >
          <li v-for="sample in pathSamples" :key="sample">{{ sample }}</li>
        </ul>
      </div>

      <div class="mb-[22px]">
        <label
          class="mb-2.5 block text-[0.88rem] font-semibold text-[var(--text-muted)]"
        >
          Batch Name
        </label>
        <input
          v-model="batchName"
          type="text"
          class="w-full rounded-[14px] border border-white/10 bg-white/[0.04] px-4 py-3 text-[0.9rem] text-[var(--text)] outline-none focus:border-[rgba(109,212,236,0.35)]"
          placeholder="Selection batch"
        />
      </div>

      <div class="mb-[22px]">
        <label
          class="mb-2.5 block text-[0.88rem] font-semibold text-[var(--text-muted)]"
        >
          Quality (QP) — lower = better quality, larger file
        </label>
        <div class="flex items-center gap-3.5">
          <input
            v-model.number="qp"
            type="range"
            min="0"
            max="51"
            step="1"
            class="h-2 flex-1 cursor-pointer accent-[var(--accent)]"
          />
          <span class="min-w-[2.5ch] font-mono text-[1.2rem] font-bold">{{
            qp
          }}</span>
        </div>
        <div
          class="mt-1.5 flex justify-between text-[0.76rem] text-[var(--text-dim)]"
        >
          <span>0 — lossless</span><span>22 — default</span
          ><span>51 — worst</span>
        </div>
      </div>

      <div class="mb-[22px]">
        <label
          class="mb-2.5 block text-[0.88rem] font-semibold text-[var(--text-muted)]"
          >Encoder</label
        >
        <div class="flex gap-2">
          <button
            type="button"
            class="flex-1 rounded-[14px] border px-4 py-3 text-[0.88rem] font-bold transition-all"
            :class="
              encoder === 'vaapi'
                ? 'border-[var(--accent)] bg-[rgba(109,212,236,0.12)] text-[var(--text)]'
                : 'border-white/10 bg-white/[0.03] text-[var(--text-muted)]'
            "
            :disabled="!canVaapi"
            @click="encoder = 'vaapi'"
          >
            Intel VAAPI
            <span
              v-if="!canVaapi"
              class="mt-0.5 block text-[0.7rem] font-normal text-[var(--danger)]"
              >unavailable</span
            >
          </button>
          <button
            type="button"
            class="flex-1 rounded-[14px] border px-4 py-3 text-[0.88rem] font-bold transition-all"
            :class="
              encoder === 'videotoolbox'
                ? 'border-[var(--accent)] bg-[rgba(109,212,236,0.12)] text-[var(--text)]'
                : 'border-white/10 bg-white/[0.03] text-[var(--text-muted)]'
            "
            :disabled="!canVideoToolbox"
            @click="encoder = 'videotoolbox'"
          >
            Apple VideoToolbox
            <span
              v-if="!canVideoToolbox"
              class="mt-0.5 block text-[0.7rem] font-normal text-[var(--danger)]"
              >unavailable</span
            >
          </button>
          <button
            type="button"
            class="flex-1 rounded-[14px] border px-4 py-3 text-[0.88rem] font-bold transition-all"
            :class="
              encoder === 'software'
                ? 'border-[var(--accent)] bg-[rgba(109,212,236,0.12)] text-[var(--text)]'
                : 'border-white/10 bg-white/[0.03] text-[var(--text-muted)]'
            "
            @click="encoder = 'software'"
          >
            Software (libx265)
          </button>
        </div>
      </div>

      <div class="mb-[22px]">
        <label
          class="mb-2.5 block text-[0.88rem] font-semibold text-[var(--text-muted)]"
          >Streams</label
        >
        <div class="flex gap-2">
          <button
            type="button"
            class="flex-1 rounded-[14px] border px-4 py-3 text-[0.88rem] font-bold transition-all"
            :class="
              streamSelection === 'all'
                ? 'border-[var(--accent)] bg-[rgba(109,212,236,0.12)] text-[var(--text)]'
                : 'border-white/10 bg-white/[0.03] text-[var(--text-muted)]'
            "
            @click="streamSelection = 'all'"
          >
            Keep All Streams
          </button>
          <button
            type="button"
            class="flex-1 rounded-[14px] border px-4 py-3 text-[0.88rem] font-bold transition-all"
            :class="
              streamSelection === 'primary'
                ? 'border-[var(--accent)] bg-[rgba(109,212,236,0.12)] text-[var(--text)]'
                : 'border-white/10 bg-white/[0.03] text-[var(--text-muted)]'
            "
            @click="streamSelection = 'primary'"
          >
            First Video + Audio
          </button>
        </div>
      </div>

      <div class="mb-[22px]">
        <label
          class="mb-2.5 block text-[0.88rem] font-semibold text-[var(--text-muted)]"
          >Audio Streams</label
        >
        <div class="flex gap-2">
          <button
            type="button"
            class="flex-1 rounded-[14px] border px-4 py-3 text-[0.88rem] font-bold transition-all"
            :class="
              audioMode === 'copy'
                ? 'border-[var(--accent)] bg-[rgba(109,212,236,0.12)] text-[var(--text)]'
                : 'border-white/10 bg-white/[0.03] text-[var(--text-muted)]'
            "
            @click="audioMode = 'copy'"
          >
            Copy Audio
          </button>
          <button
            type="button"
            class="flex-1 rounded-[14px] border px-4 py-3 text-[0.88rem] font-bold transition-all"
            :class="
              audioMode === 'aac'
                ? 'border-[var(--accent)] bg-[rgba(109,212,236,0.12)] text-[var(--text)]'
                : 'border-white/10 bg-white/[0.03] text-[var(--text-muted)]'
            "
            @click="audioMode = 'aac'"
          >
            Re-encode to AAC
          </button>
        </div>
      </div>

      <div class="mb-[22px]">
        <label
          class="mb-2.5 block text-[0.88rem] font-semibold text-[var(--text-muted)]"
          >Subtitle Streams</label
        >
        <div class="flex gap-2">
          <button
            type="button"
            class="flex-1 rounded-[14px] border px-4 py-3 text-[0.88rem] font-bold transition-all"
            :class="
              subtitleMode === 'copy'
                ? 'border-[var(--accent)] bg-[rgba(109,212,236,0.12)] text-[var(--text)]'
                : 'border-white/10 bg-white/[0.03] text-[var(--text-muted)]'
            "
            @click="subtitleMode = 'copy'"
          >
            Keep Subtitles
          </button>
          <button
            type="button"
            class="flex-1 rounded-[14px] border px-4 py-3 text-[0.88rem] font-bold transition-all"
            :class="
              subtitleMode === 'drop'
                ? 'border-[var(--accent)] bg-[rgba(109,212,236,0.12)] text-[var(--text)]'
                : 'border-white/10 bg-white/[0.03] text-[var(--text-muted)]'
            "
            @click="subtitleMode = 'drop'"
          >
            Remove Subtitles
          </button>
        </div>
      </div>

      <p v-if="successMsg" class="mt-3 text-[0.92rem] text-[var(--success)]">
        {{ successMsg }}
      </p>

      <p v-if="errorMsg" class="mt-3 text-[0.92rem] text-[var(--danger)]">
        {{ errorMsg }}
      </p>

      <footer class="mt-7 flex justify-end gap-3">
        <button
          type="button"
          class="rounded-full border border-white/10 bg-white/[0.04] px-5 py-3 font-extrabold text-[var(--text)] transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-65"
          @click="$emit('close')"
        >
          Cancel
        </button>
        <button
          type="button"
          class="rounded-full bg-[linear-gradient(135deg,var(--accent)_0%,var(--accent-two)_100%)] px-[22px] py-[13px] font-extrabold text-[#08090d] shadow-[0_10px_30px_rgba(109,212,236,0.26)] transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-65"
          :disabled="submitting || !paths.length"
          @click="submit"
        >
          {{ submitting ? "Queueing..." : "Queue Selection" }}
        </button>
      </footer>

      <div
        v-if="overwritePromptOpen"
        class="absolute inset-0 z-30 flex items-center justify-center rounded-[28px] bg-black/50 p-4 backdrop-blur-[3px]"
        @click.self="cancelOverwritePrompt"
      >
        <section
          class="w-[min(520px,100%)] rounded-[20px] border border-white/12 bg-[var(--glass-strong)] p-5 shadow-[var(--shadow-deep)]"
        >
          <p
            class="mb-2 inline-flex items-center gap-2 rounded-full border border-[rgba(242,125,145,0.26)] bg-[rgba(242,125,145,0.14)] px-3 py-1 text-[0.68rem] font-extrabold uppercase tracking-[0.14em] text-[var(--danger)]"
          >
            Overwrite Required
          </p>
          <h4 class="m-0 text-[1.02rem] font-extrabold tracking-[-0.02em]">
            Existing Output Detected
          </h4>
          <p
            class="mb-0 mt-2 text-[0.9rem] leading-relaxed text-[var(--text-muted)]"
          >
            {{ overwritePromptText }}
          </p>

          <p class="mb-0 mt-3 text-[0.8rem] text-[var(--text-dim)]">
            {{ overwritePromptCount }} file{{
              overwritePromptCount === 1 ? "" : "s"
            }}
            affected
          </p>
          <ul
            v-if="overwritePromptExamples.length"
            class="mb-0 mt-2 max-h-28 list-disc space-y-1 overflow-auto pl-5 text-[0.78rem] text-[var(--text-dim)]"
          >
            <li v-for="item in overwritePromptExamples" :key="item">
              {{ item }}
            </li>
          </ul>

          <div class="mt-4 flex justify-end gap-2">
            <button
              type="button"
              class="rounded-full border border-white/12 bg-white/[0.05] px-3.5 py-2 text-[0.78rem] font-bold text-[var(--text)]"
              @click="cancelOverwritePrompt"
            >
              Cancel
            </button>
            <button
              type="button"
              class="rounded-full border border-[rgba(242,125,145,0.3)] bg-[rgba(242,125,145,0.14)] px-3.5 py-2 text-[0.78rem] font-bold text-[var(--danger)]"
              @click="confirmOverwritePrompt"
            >
              Overwrite And Queue
            </button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
