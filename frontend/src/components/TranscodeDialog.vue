<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useQueueStore } from "../stores/queue.ts";
import { useStatusStore } from "../stores/status.ts";
import type {
  AudioMode,
  EncoderChoice,
  FsEntry,
  MediaStreamInfo,
  StreamMapSelection,
  StreamSelection,
  SubtitleMode,
} from "../types.ts";

const props = defineProps<{ path: string; entry: FsEntry }>();
const emit = defineEmits<{ close: []; submitted: [] }>();

const queue = useQueueStore();
const status = useStatusStore();

const qp = ref(status.defaultTranscode.qp);
const encoder = ref<EncoderChoice>(status.defaultTranscode.encoder);
const streamSelection = ref<StreamSelection>(
  status.defaultTranscode.streamSelection,
);
const availableStreams = ref<MediaStreamInfo[]>([]);
const streamsLoading = ref(false);
const selectedVideoIndex = ref<number | null>(null);
const selectedAudioIndex = ref<number | null>(null);
const selectedSubtitleIndex = ref<number | null>(null);
const audioMode = ref<AudioMode>(status.defaultTranscode.audioMode);
const subtitleMode = ref<SubtitleMode>(status.defaultTranscode.subtitleMode);
const submitting = ref(false);
const errorMsg = ref<string | null>(null);
const successMsg = ref<string | null>(null);

const canVaapi = computed(() => status.availableEncoders.includes("vaapi"));
const canVideoToolbox = computed(() =>
  status.availableEncoders.includes("videotoolbox"),
);
const isDirectory = computed(() => props.entry.type === "directory");
const isPrimarySelection = computed(
  () => streamSelection.value === "primary" && !isDirectory.value,
);

const videoStreams = computed(() =>
  availableStreams.value.filter((s) => s.codecType === "video"),
);
const audioStreams = computed(() =>
  availableStreams.value.filter((s) => s.codecType === "audio"),
);
const subtitleStreams = computed(() =>
  availableStreams.value.filter((s) => s.codecType === "subtitle"),
);

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

function formatSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function streamLabel(s: MediaStreamInfo): string {
  if (s.codecType === "video") {
    const dim = s.width && s.height ? ` ${s.width}x${s.height}` : "";
    return `#${s.index} ${s.codecName ?? "video"}${dim}`;
  }
  if (s.codecType === "audio") {
    const ch = s.channels ? ` ${s.channels}ch` : "";
    const lang = s.language ? ` ${s.language}` : "";
    return `#${s.index} ${s.codecName ?? "audio"}${ch}${lang}`;
  }
  const lang = s.language ? ` ${s.language}` : "";
  const title = s.title ? ` ${s.title}` : "";
  return `#${s.index} ${s.codecName ?? "subtitle"}${lang}${title}`;
}

async function loadStreams(): Promise<void> {
  if (isDirectory.value) {
    availableStreams.value = [];
    selectedVideoIndex.value = null;
    selectedAudioIndex.value = null;
    selectedSubtitleIndex.value = null;
    return;
  }

  streamsLoading.value = true;
  try {
    const res = await fetch(
      `/api/fs/streams?path=${encodeURIComponent(props.path)}`,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { streams?: MediaStreamInfo[] };
    const streams = data.streams ?? [];
    availableStreams.value = streams;

    const firstVideo = streams.find((s) => s.codecType === "video");
    const firstAudio = streams.find((s) => s.codecType === "audio");
    const firstSubtitle = streams.find((s) => s.codecType === "subtitle");
    selectedVideoIndex.value = firstVideo?.index ?? null;
    selectedAudioIndex.value = firstAudio?.index ?? null;
    selectedSubtitleIndex.value = firstSubtitle?.index ?? null;
  } catch {
    availableStreams.value = [];
    selectedVideoIndex.value = null;
    selectedAudioIndex.value = null;
    selectedSubtitleIndex.value = null;
  } finally {
    streamsLoading.value = false;
  }
}

watch(
  () => props.path,
  () => {
    void loadStreams();
  },
  { immediate: true },
);

async function submit(): Promise<void> {
  submitting.value = true;
  errorMsg.value = null;
  successMsg.value = null;
  try {
    const streamMap: StreamMapSelection | undefined = isPrimarySelection.value
      ? {
          videoIndex: selectedVideoIndex.value ?? undefined,
          audioIndex: selectedAudioIndex.value,
          subtitleIndex:
            subtitleMode.value === "copy" ? selectedSubtitleIndex.value : null,
        }
      : undefined;

    if (isPrimarySelection.value && selectedVideoIndex.value == null) {
      throw new Error("Please select a video stream for primary mode.");
    }

    if (isDirectory.value) {
      const queued = await queue.submitFolder(
        props.path,
        qp.value,
        encoder.value,
        streamSelection.value,
        audioMode.value,
        subtitleMode.value,
      );
      successMsg.value = `Queued ${queued} file${queued === 1 ? "" : "s"}.`;
      emit("submitted");
      emit("close");
      return;
    }

    await queue.submit(
      props.path,
      qp.value,
      encoder.value,
      streamSelection.value,
      streamMap,
      audioMode.value,
      subtitleMode.value,
    );
    successMsg.value = "Queued 1 file.";
    emit("submitted");
    emit("close");
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : "Failed to queue job";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div
    class="fixed inset-0 z-[200] flex items-center justify-center bg-black/65 p-6 backdrop-blur-[6px]"
    @click.self="$emit('close')"
  >
    <div
      class="relative w-[min(560px,100%)] rounded-[28px] border border-[var(--border)] bg-[var(--glass-strong)] p-8 shadow-[var(--shadow-deep)] backdrop-blur-[24px] max-[760px]:p-[22px]"
    >
      <header class="mb-6">
        <div
          class="mb-3 inline-flex items-center gap-2 rounded-full border border-[rgba(109,212,236,0.22)] bg-[rgba(109,212,236,0.1)] px-3.5 py-1.5 text-[0.72rem] font-extrabold uppercase tracking-[0.12em] text-[var(--accent)]"
        >
          <span
            class="h-[7px] w-[7px] rounded-full bg-[var(--accent)] shadow-[0_0_18px_rgba(109,212,236,0.6)]"
          ></span
          >Transcode
        </div>
        <h2 class="m-0 text-[1.6rem] font-black tracking-[-0.04em]">
          {{ isDirectory ? "Queue Folder" : "Configure Job" }}
        </h2>
      </header>

      <div
        class="mb-6 flex items-center gap-2.5 rounded-[14px] border border-white/10 bg-white/[0.04] px-4 py-3.5"
      >
        <span class="shrink-0 text-[1.1em]">{{
          isDirectory ? "📁" : "🎬"
        }}</span>
        <span
          class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-semibold"
          :title="path"
          >{{ entry.name }}</span
        >
        <span
          v-if="entry.sizeBytes"
          class="shrink-0 font-mono text-[0.82rem] text-[var(--text-dim)]"
          >{{ formatSize(entry.sizeBytes) }}</span
        >
      </div>

      <div class="mb-[22px]">
        <label
          class="mb-2.5 block text-[0.88rem] font-semibold text-[var(--text-muted)]"
        >
          Quality (QP) — lower = better quality, larger file
        </label>
        <div class="flex items-center gap-3.5">
          <input
            type="range"
            min="0"
            max="51"
            step="1"
            v-model.number="qp"
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

      <div v-if="isPrimarySelection" class="mb-[22px] grid gap-3">
        <p class="m-0 text-[0.8rem] text-[var(--text-dim)]">
          Select exact streams to keep for this file.
        </p>

        <div
          v-if="streamsLoading"
          class="text-[0.84rem] text-[var(--text-muted)]"
        >
          Loading available streams...
        </div>

        <template v-else>
          <div class="grid gap-1.5">
            <label class="text-[0.82rem] font-semibold text-[var(--text-muted)]"
              >Video Stream</label
            >
            <select
              v-model="selectedVideoIndex"
              class="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[0.86rem] text-[var(--text)] outline-none"
            >
              <option :value="null" disabled>Select a video stream</option>
              <option v-for="s in videoStreams" :key="s.index" :value="s.index">
                {{ streamLabel(s) }}
              </option>
            </select>
          </div>

          <div class="grid gap-1.5">
            <label class="text-[0.82rem] font-semibold text-[var(--text-muted)]"
              >Audio Stream</label
            >
            <select
              v-model="selectedAudioIndex"
              class="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[0.86rem] text-[var(--text)] outline-none"
            >
              <option :value="null">No audio</option>
              <option v-for="s in audioStreams" :key="s.index" :value="s.index">
                {{ streamLabel(s) }}
              </option>
            </select>
          </div>

          <div v-if="subtitleMode === 'copy'" class="grid gap-1.5">
            <label class="text-[0.82rem] font-semibold text-[var(--text-muted)]"
              >Subtitle Stream</label
            >
            <select
              v-model="selectedSubtitleIndex"
              class="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[0.86rem] text-[var(--text)] outline-none"
            >
              <option :value="null">No subtitles</option>
              <option
                v-for="s in subtitleStreams"
                :key="s.index"
                :value="s.index"
              >
                {{ streamLabel(s) }}
              </option>
            </select>
          </div>
        </template>
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
          class="rounded-full border border-white/10 bg-white/[0.04] px-5 py-3 font-extrabold text-[var(--text)] transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-65"
          type="button"
          @click="$emit('close')"
        >
          Cancel
        </button>
        <button
          class="rounded-full bg-[linear-gradient(135deg,var(--accent)_0%,var(--accent-two)_100%)] px-[22px] py-[13px] font-extrabold text-[#08090d] shadow-[0_10px_30px_rgba(109,212,236,0.26)] transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-65"
          type="button"
          :disabled="submitting"
          @click="submit"
        >
          {{
            submitting
              ? "Queuing…"
              : isDirectory
                ? "Queue Folder"
                : "Start Transcode"
          }}
        </button>
      </footer>
    </div>
  </div>
</template>
