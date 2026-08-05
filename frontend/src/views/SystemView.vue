<script setup lang="ts">
import { ref, watch } from "vue";
import { useStatusStore } from "../stores/status.ts";
import type {
  AudioMode,
  EncoderChoice,
  StreamSelection,
  SubtitleMode,
} from "../types.ts";

const status = useStatusStore();

const savingQueue = ref(false);
const queueSaveError = ref<string | null>(null);
const queueSaveOk = ref<string | null>(null);
const savingDefaults = ref(false);
const defaultsSaveError = ref<string | null>(null);
const defaultsSaveOk = ref<string | null>(null);
const draftParallelJobs = ref(status.parallelJobs);
const draftQp = ref(status.defaultTranscode.qp);
const draftEncoder = ref<EncoderChoice>(status.defaultTranscode.encoder);
const draftStreamSelection = ref<StreamSelection>(
  status.defaultTranscode.streamSelection,
);
const draftAudioMode = ref<AudioMode>(status.defaultTranscode.audioMode);
const draftSubtitleMode = ref<SubtitleMode>(
  status.defaultTranscode.subtitleMode,
);

watch(
  () => status.parallelJobs,
  (next) => {
    draftParallelJobs.value = next;
  },
  { immediate: true },
);

watch(
  () => status.defaultTranscode,
  (next) => {
    draftQp.value = next.qp;
    draftEncoder.value = next.encoder;
    draftStreamSelection.value = next.streamSelection;
    draftAudioMode.value = next.audioMode;
    draftSubtitleMode.value = next.subtitleMode;
  },
  { immediate: true, deep: true },
);

async function saveParallelJobs(): Promise<void> {
  queueSaveError.value = null;
  queueSaveOk.value = null;
  savingQueue.value = true;

  try {
    const raw = Number(draftParallelJobs.value);
    if (!Number.isFinite(raw) || !Number.isInteger(raw)) {
      throw new Error("Parallel jobs must be a whole number.");
    }

    const clamped = Math.max(
      status.settingsLimits.min,
      Math.min(status.settingsLimits.max, raw),
    );

    draftParallelJobs.value = clamped;
    await status.updateParallelJobs(clamped);
    queueSaveOk.value = "Saved. New queue limit is active immediately.";
  } catch (err) {
    queueSaveError.value = err instanceof Error ? err.message : String(err);
  } finally {
    savingQueue.value = false;
  }
}

async function saveTranscodeDefaults(): Promise<void> {
  defaultsSaveError.value = null;
  defaultsSaveOk.value = null;
  savingDefaults.value = true;

  try {
    const clampedQp = Math.max(0, Math.min(51, Math.floor(draftQp.value)));
    await status.updateDefaultTranscode({
      qp: clampedQp,
      encoder: draftEncoder.value,
      streamSelection: draftStreamSelection.value,
      audioMode: draftAudioMode.value,
      subtitleMode: draftSubtitleMode.value,
    });
    defaultsSaveOk.value = "Saved default transcode options.";
  } catch (err) {
    defaultsSaveError.value = err instanceof Error ? err.message : String(err);
  } finally {
    savingDefaults.value = false;
  }
}
</script>

<template>
  <div class="grid gap-[22px]">
    <article
      class="relative rounded-[28px] border border-white/10 bg-[var(--glass)] p-7 shadow-[var(--shadow-deep),var(--shadow-glow)] backdrop-blur-[18px] backdrop-saturate-150 max-[760px]:p-5"
    >
      <div class="mb-5 flex items-start justify-between gap-5">
        <div>
          <div
            class="mb-3.5 inline-flex items-center gap-2 rounded-full border border-[rgba(109,212,236,0.22)] bg-[rgba(109,212,236,0.1)] px-3.5 py-1.5 text-[0.72rem] font-extrabold uppercase tracking-[0.12em] text-[var(--accent)]"
          >
            <span
              class="h-[7px] w-[7px] rounded-full bg-[var(--accent)] shadow-[0_0_18px_rgba(109,212,236,0.6)]"
            ></span
            >System
          </div>
          <h2 class="m-0 text-[1.7rem] font-black tracking-[-0.04em]">
            Hardware Status
          </h2>
        </div>
      </div>
      <dl class="m-0 grid">
        <div
          class="flex justify-between gap-3.5 border-b border-white/10 py-3.5 first:pt-0"
        >
          <dt class="text-[var(--text-muted)]">Intel VAAPI</dt>
          <dd
            class="m-0 font-mono font-bold"
            :style="{
              color: status.availableEncoders.includes('vaapi')
                ? 'var(--success)'
                : 'var(--danger)',
            }"
          >
            {{
              status.availableEncoders.includes("vaapi")
                ? "Available"
                : "Unavailable"
            }}
          </dd>
        </div>
        <div
          class="flex justify-between gap-3.5 border-b border-white/10 py-3.5"
        >
          <dt class="text-[var(--text-muted)]">Apple VideoToolbox</dt>
          <dd
            class="m-0 font-mono font-bold"
            :style="{
              color: status.availableEncoders.includes('videotoolbox')
                ? 'var(--success)'
                : 'var(--danger)',
            }"
          >
            {{
              status.availableEncoders.includes("videotoolbox")
                ? "Available"
                : "Unavailable"
            }}
          </dd>
        </div>
        <div
          class="flex justify-between gap-3.5 border-b border-white/10 py-3.5"
        >
          <dt class="text-[var(--text-muted)]">Software fallback</dt>
          <dd class="m-0 font-mono font-bold text-[var(--success)]">
            libx265 (always available)
          </dd>
        </div>
        <div
          class="flex justify-between gap-3.5 border-b border-white/10 py-3.5"
        >
          <dt class="text-[var(--text-muted)]">SSE connection</dt>
          <dd
            class="m-0 font-mono font-bold"
            :style="{
              color: status.connected ? 'var(--success)' : 'var(--warn)',
            }"
          >
            {{ status.connected ? "Connected" : "Reconnecting…" }}
          </dd>
        </div>
      </dl>
    </article>

    <article
      class="relative rounded-[28px] border border-white/10 bg-[var(--glass)] p-7 shadow-[var(--shadow-deep),var(--shadow-glow)] backdrop-blur-[18px] backdrop-saturate-150 max-[760px]:p-5"
    >
      <div class="mb-5">
        <h2 class="m-0 text-[1.55rem] font-black tracking-[-0.03em]">
          Queue Settings
        </h2>
        <p class="mt-2 text-[0.92rem] text-[var(--text-muted)]">
          Change how many transcodes can run in parallel without restarting the
          container.
        </p>
      </div>

      <div class="grid gap-3.5">
        <label class="text-[0.82rem] font-semibold text-[var(--text-muted)]"
          >Parallel jobs</label
        >
        <p class="m-0 text-[0.8rem] text-[var(--text-dim)]">
          Maximum number of files transcoded at the same time. Lower values
          reduce CPU/GPU load; higher values improve throughput.
        </p>
        <div class="flex items-center gap-3">
          <input
            v-model.number="draftParallelJobs"
            class="w-24 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[var(--text)] outline-none focus:border-[rgba(109,212,236,0.35)]"
            type="number"
            :min="status.settingsLimits.min"
            :max="status.settingsLimits.max"
          />
          <button
            class="rounded-full border border-[rgba(109,212,236,0.35)] bg-[rgba(109,212,236,0.13)] px-4 py-2 text-[0.84rem] font-bold text-[var(--text)] transition-colors hover:bg-[rgba(109,212,236,0.2)] disabled:opacity-50"
            type="button"
            :disabled="savingQueue"
            @click="saveParallelJobs"
          >
            {{ savingQueue ? "Saving..." : "Apply" }}
          </button>
        </div>
        <p class="m-0 text-[0.8rem] text-[var(--text-dim)]">
          Allowed range: {{ status.settingsLimits.min }} to
          {{ status.settingsLimits.max }}. Current: {{ status.parallelJobs }}.
        </p>
        <p v-if="queueSaveOk" class="m-0 text-[0.82rem] text-[var(--success)]">
          {{ queueSaveOk }}
        </p>
        <p
          v-if="queueSaveError"
          class="m-0 text-[0.82rem] text-[var(--danger)]"
        >
          {{ queueSaveError }}
        </p>
      </div>
    </article>

    <article
      class="relative rounded-[28px] border border-white/10 bg-[var(--glass)] p-7 shadow-[var(--shadow-deep),var(--shadow-glow)] backdrop-blur-[18px] backdrop-saturate-150 max-[760px]:p-5"
    >
      <div class="mb-5">
        <h2 class="m-0 text-[1.55rem] font-black tracking-[-0.03em]">
          Default Transcode Options
        </h2>
        <p class="mt-2 text-[0.92rem] text-[var(--text-muted)]">
          These defaults prefill the transcode dialog for files and folders.
        </p>
      </div>

      <div class="grid gap-4">
        <div class="grid gap-2">
          <label class="text-[0.82rem] font-semibold text-[var(--text-muted)]"
            >Quality (QP)</label
          >
          <p class="m-0 text-[0.8rem] text-[var(--text-dim)]">
            Lower QP keeps more quality but larger files. Higher QP compresses
            more but may lose detail.
          </p>
          <div class="flex items-center gap-3">
            <input
              v-model.number="draftQp"
              class="w-24 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[var(--text)] outline-none focus:border-[rgba(109,212,236,0.35)]"
              type="number"
              min="0"
              max="51"
            />
            <span class="text-[0.82rem] text-[var(--text-dim)]">0-51</span>
          </div>
        </div>

        <div class="grid gap-2">
          <label class="text-[0.82rem] font-semibold text-[var(--text-muted)]"
            >Encoder</label
          >
          <p class="m-0 text-[0.8rem] text-[var(--text-dim)]">
            Picks the video encoder backend. Hardware options are usually
            faster; software is the compatibility fallback.
          </p>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-full border px-3.5 py-2 text-[0.8rem] font-bold"
              :class="
                draftEncoder === 'vaapi'
                  ? 'border-[var(--accent)] bg-[rgba(109,212,236,0.12)]'
                  : 'border-white/10 bg-white/[0.03] text-[var(--text-muted)]'
              "
              @click="draftEncoder = 'vaapi'"
            >
              VAAPI
            </button>
            <button
              type="button"
              class="rounded-full border px-3.5 py-2 text-[0.8rem] font-bold"
              :class="
                draftEncoder === 'videotoolbox'
                  ? 'border-[var(--accent)] bg-[rgba(109,212,236,0.12)]'
                  : 'border-white/10 bg-white/[0.03] text-[var(--text-muted)]'
              "
              @click="draftEncoder = 'videotoolbox'"
            >
              VideoToolbox
            </button>
            <button
              type="button"
              class="rounded-full border px-3.5 py-2 text-[0.8rem] font-bold"
              :class="
                draftEncoder === 'software'
                  ? 'border-[var(--accent)] bg-[rgba(109,212,236,0.12)]'
                  : 'border-white/10 bg-white/[0.03] text-[var(--text-muted)]'
              "
              @click="draftEncoder = 'software'"
            >
              Software
            </button>
          </div>
        </div>

        <div class="grid gap-2">
          <label class="text-[0.82rem] font-semibold text-[var(--text-muted)]"
            >Streams</label
          >
          <p class="m-0 text-[0.8rem] text-[var(--text-dim)]">
            All streams preserves every video/audio/subtitle stream. First video
            + audio keeps only the primary tracks.
          </p>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-full border px-3.5 py-2 text-[0.8rem] font-bold"
              :class="
                draftStreamSelection === 'all'
                  ? 'border-[var(--accent)] bg-[rgba(109,212,236,0.12)]'
                  : 'border-white/10 bg-white/[0.03] text-[var(--text-muted)]'
              "
              @click="draftStreamSelection = 'all'"
            >
              All streams
            </button>
            <button
              type="button"
              class="rounded-full border px-3.5 py-2 text-[0.8rem] font-bold"
              :class="
                draftStreamSelection === 'primary'
                  ? 'border-[var(--accent)] bg-[rgba(109,212,236,0.12)]'
                  : 'border-white/10 bg-white/[0.03] text-[var(--text-muted)]'
              "
              @click="draftStreamSelection = 'primary'"
            >
              First video + audio
            </button>
          </div>
        </div>

        <div class="grid gap-2">
          <label class="text-[0.82rem] font-semibold text-[var(--text-muted)]"
            >Audio</label
          >
          <p class="m-0 text-[0.8rem] text-[var(--text-dim)]">
            Copy audio keeps original audio codec. Re-encode AAC improves
            playback compatibility across browsers/devices.
          </p>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-full border px-3.5 py-2 text-[0.8rem] font-bold"
              :class="
                draftAudioMode === 'copy'
                  ? 'border-[var(--accent)] bg-[rgba(109,212,236,0.12)]'
                  : 'border-white/10 bg-white/[0.03] text-[var(--text-muted)]'
              "
              @click="draftAudioMode = 'copy'"
            >
              Copy audio
            </button>
            <button
              type="button"
              class="rounded-full border px-3.5 py-2 text-[0.8rem] font-bold"
              :class="
                draftAudioMode === 'aac'
                  ? 'border-[var(--accent)] bg-[rgba(109,212,236,0.12)]'
                  : 'border-white/10 bg-white/[0.03] text-[var(--text-muted)]'
              "
              @click="draftAudioMode = 'aac'"
            >
              Re-encode AAC
            </button>
          </div>
        </div>

        <div class="grid gap-2">
          <label class="text-[0.82rem] font-semibold text-[var(--text-muted)]"
            >Subtitles</label
          >
          <p class="m-0 text-[0.8rem] text-[var(--text-dim)]">
            Keep subtitles copies subtitle streams into output. Remove subtitles
            drops subtitle streams entirely.
          </p>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-full border px-3.5 py-2 text-[0.8rem] font-bold"
              :class="
                draftSubtitleMode === 'copy'
                  ? 'border-[var(--accent)] bg-[rgba(109,212,236,0.12)]'
                  : 'border-white/10 bg-white/[0.03] text-[var(--text-muted)]'
              "
              @click="draftSubtitleMode = 'copy'"
            >
              Keep subtitles
            </button>
            <button
              type="button"
              class="rounded-full border px-3.5 py-2 text-[0.8rem] font-bold"
              :class="
                draftSubtitleMode === 'drop'
                  ? 'border-[var(--accent)] bg-[rgba(109,212,236,0.12)]'
                  : 'border-white/10 bg-white/[0.03] text-[var(--text-muted)]'
              "
              @click="draftSubtitleMode = 'drop'"
            >
              Remove subtitles
            </button>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <button
            class="rounded-full border border-[rgba(109,212,236,0.35)] bg-[rgba(109,212,236,0.13)] px-4 py-2 text-[0.84rem] font-bold text-[var(--text)] transition-colors hover:bg-[rgba(109,212,236,0.2)] disabled:opacity-50"
            type="button"
            :disabled="savingDefaults"
            @click="saveTranscodeDefaults"
          >
            {{ savingDefaults ? "Saving..." : "Save Defaults" }}
          </button>
          <p class="m-0 text-[0.8rem] text-[var(--text-dim)]">
            Applied to new transcode dialogs.
          </p>
        </div>

        <p
          v-if="defaultsSaveOk"
          class="m-0 text-[0.82rem] text-[var(--success)]"
        >
          {{ defaultsSaveOk }}
        </p>
        <p
          v-if="defaultsSaveError"
          class="m-0 text-[0.82rem] text-[var(--danger)]"
        >
          {{ defaultsSaveError }}
        </p>
      </div>
    </article>
  </div>
</template>
