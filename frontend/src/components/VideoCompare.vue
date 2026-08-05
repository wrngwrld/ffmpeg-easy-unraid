<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";

const props = defineProps<{
  sourcePath: string;
  outputPath: string;
}>();
defineEmits<{ close: [] }>();

const sourceRef = ref<HTMLVideoElement | null>(null);
const outputRef = ref<HTMLVideoElement | null>(null);
const stageRef = ref<HTMLDivElement | null>(null);

const isPlaying = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const splitPct = ref(50); // divider position 0-100
const isDragging = ref(false);
const isSyncing = ref(false);
const sourceError = ref<string | null>(null);
const outputError = ref<string | null>(null);
const sourceLikelyUnsupported = ref(false);
const outputLikelyUnsupported = ref(false);
const zoom = ref(1);
const panX = ref(0);
const panY = ref(0);
const isPanning = ref(false);
const panStartX = ref(0);
const panStartY = ref(0);

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

const MIME_BY_EXT: Record<string, string> = {
  mkv: "video/x-matroska",
  mp4: "video/mp4",
  ts: "video/mp2t",
  m2ts: "video/mp2t",
  avi: "video/x-msvideo",
  mov: "video/quicktime",
  wmv: "video/x-ms-wmv",
};

const sourceUrl = computed(
  () => `/api/stream/source?path=${encodeURIComponent(props.sourcePath)}`,
);
const outputUrl = computed(
  () => `/api/stream/output?path=${encodeURIComponent(props.outputPath)}`,
);
const zoomPercent = computed(() => Math.round(zoom.value * 100));
const videoTransform = computed(
  () => `translate(${panX.value}px, ${panY.value}px) scale(${zoom.value})`,
);
const sourceVideoStyle = computed(() => ({
  clipPath: `inset(0 ${100 - splitPct.value}% 0 0)`,
  transform: videoTransform.value,
  transformOrigin: "center center",
}));
const outputVideoStyle = computed(() => ({
  clipPath: `inset(0 0 0 ${splitPct.value}%)`,
  transform: videoTransform.value,
  transformOrigin: "center center",
}));

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function clampPan(nextX: number, nextY: number): { x: number; y: number } {
  const el = stageRef.value;
  if (!el || zoom.value <= 1) return { x: 0, y: 0 };

  const rect = el.getBoundingClientRect();
  const maxX = ((zoom.value - 1) * rect.width) / 2;
  const maxY = ((zoom.value - 1) * rect.height) / 2;

  return {
    x: clamp(nextX, -maxX, maxX),
    y: clamp(nextY, -maxY, maxY),
  };
}

function setZoom(nextZoom: number): void {
  zoom.value = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);

  if (zoom.value <= 1) {
    panX.value = 0;
    panY.value = 0;
    return;
  }

  const p = clampPan(panX.value, panY.value);
  panX.value = p.x;
  panY.value = p.y;
}

function zoomIn(): void {
  setZoom(zoom.value + 0.2);
}

function zoomOut(): void {
  setZoom(zoom.value - 0.2);
}

function resetView(): void {
  setZoom(1);
}

function onZoomInput(e: Event): void {
  setZoom(parseFloat((e.target as HTMLInputElement).value));
}

function onWheel(e: WheelEvent): void {
  const step = e.deltaY < 0 ? 0.15 : -0.15;
  setZoom(zoom.value + step);
}

function extOf(p: string): string {
  const i = p.lastIndexOf(".");
  return i === -1 ? "" : p.slice(i + 1).toLowerCase();
}

function likelyUnsupportedByBrowser(path: string): boolean {
  const ext = extOf(path);
  const mime = MIME_BY_EXT[ext];
  if (!mime) return false;
  const probe = document.createElement("video");
  return probe.canPlayType(mime) === "";
}

function onSourceError(): void {
  sourceError.value =
    "Original stream failed to load in this browser (container/codec may be unsupported).";
}

function onOutputError(): void {
  outputError.value =
    "Transcoded stream failed to load in this browser (container/codec may be unsupported).";
}

function startPan(e: MouseEvent): void {
  if (zoom.value <= 1) return;
  const target = e.target as HTMLElement;
  if (target.closest("[data-divider='1']")) return;

  isPanning.value = true;
  panStartX.value = e.clientX - panX.value;
  panStartY.value = e.clientY - panY.value;
}

function syncTo(primary: HTMLVideoElement, secondary: HTMLVideoElement): void {
  if (isSyncing.value) return;
  isSyncing.value = true;
  secondary.currentTime = primary.currentTime;
  isSyncing.value = false;
}

function onSourceTimeUpdate(): void {
  if (!sourceRef.value) return;
  currentTime.value = sourceRef.value.currentTime;
  if (
    outputRef.value &&
    Math.abs(outputRef.value.currentTime - sourceRef.value.currentTime) > 0.3
  ) {
    syncTo(sourceRef.value, outputRef.value);
  }
}

function onSourceDuration(): void {
  if (sourceRef.value) duration.value = sourceRef.value.duration;
}

function onScrubberInput(e: Event): void {
  const t = parseFloat((e.target as HTMLInputElement).value);
  if (sourceRef.value) sourceRef.value.currentTime = t;
  if (outputRef.value) outputRef.value.currentTime = t;
  currentTime.value = t;
}

function togglePlay(): void {
  if (!sourceRef.value || !outputRef.value) return;
  if (isPlaying.value) {
    sourceRef.value.pause();
    outputRef.value.pause();
  } else {
    void sourceRef.value.play();
    void outputRef.value.play();
  }
  isPlaying.value = !isPlaying.value;
}

function onPlayPause(): void {
  if (!sourceRef.value) return;
  isPlaying.value = !sourceRef.value.paused;
  if (isPlaying.value && outputRef.value?.paused) void outputRef.value.play();
  if (!isPlaying.value && !outputRef.value?.paused) outputRef.value?.pause();
}

// drag logic for the split divider
function startDrag(): void {
  isDragging.value = true;
}

function onMouseMove(e: MouseEvent): void {
  const container = e.currentTarget as HTMLElement;

  if (isDragging.value) {
    const rect = container.getBoundingClientRect();
    splitPct.value = Math.max(
      5,
      Math.min(95, ((e.clientX - rect.left) / rect.width) * 100),
    );
    return;
  }

  if (!isPanning.value) return;

  const p = clampPan(e.clientX - panStartX.value, e.clientY - panStartY.value);
  panX.value = p.x;
  panY.value = p.y;
}

function stopDrag(): void {
  isDragging.value = false;
  isPanning.value = false;
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

onMounted(() => {
  sourceLikelyUnsupported.value = likelyUnsupportedByBrowser(props.sourcePath);
  outputLikelyUnsupported.value = likelyUnsupportedByBrowser(props.outputPath);

  sourceRef.value?.addEventListener("timeupdate", onSourceTimeUpdate);
  sourceRef.value?.addEventListener("loadedmetadata", onSourceDuration);
  sourceRef.value?.addEventListener("play", onPlayPause);
  sourceRef.value?.addEventListener("pause", onPlayPause);
});

onBeforeUnmount(() => {
  sourceRef.value?.pause();
  outputRef.value?.pause();
});
</script>

<template>
  <div
    class="fixed inset-0 z-[300] flex items-center justify-center bg-black/90 p-5"
    @click.self="$emit('close')"
  >
    <div
      class="flex max-h-[calc(100vh-40px)] w-[min(1100px,100%)] flex-col overflow-hidden rounded-[28px] border border-[var(--border)] bg-[rgba(14,16,24,0.98)] shadow-[var(--shadow-deep)] max-[760px]:max-h-screen max-[760px]:rounded-none"
    >
      <header
        class="flex items-center justify-between border-b border-white/10 px-5 py-3.5"
      >
        <div class="flex w-full gap-0">
          <span
            class="flex-1 text-[0.82rem] font-bold uppercase tracking-[0.1em] text-[var(--text-muted)]"
            >Original</span
          >
          <span
            class="flex-1 text-right text-[0.82rem] font-bold uppercase tracking-[0.1em] text-[var(--text-muted)]"
            >Transcoded</span
          >
        </div>
        <button
          class="rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-[0.84rem] font-extrabold text-[var(--text)] transition-transform hover:-translate-y-0.5"
          type="button"
          @click="$emit('close')"
        >
          Close
        </button>
      </header>

      <div
        ref="stageRef"
        :class="[
          'relative min-h-[320px] flex-1 select-none overflow-hidden bg-black max-[760px]:min-h-[240px]',
          isPanning
            ? 'cursor-grabbing'
            : zoom > 1
              ? 'cursor-grab'
              : 'cursor-col-resize',
        ]"
        @mousedown="startPan"
        @mousemove="onMouseMove"
        @mouseup="stopDrag"
        @mouseleave="stopDrag"
        @wheel.prevent="onWheel"
      >
        <!-- source fills left half via clip-path -->
        <video
          ref="sourceRef"
          class="absolute inset-0 h-full w-full object-contain"
          :src="sourceUrl"
          preload="metadata"
          :style="sourceVideoStyle"
          @error="onSourceError"
          @click.prevent
        />
        <!-- output fills right half -->
        <video
          ref="outputRef"
          class="absolute inset-0 h-full w-full object-contain"
          :src="outputUrl"
          preload="metadata"
          :style="outputVideoStyle"
          @error="onOutputError"
          @click.prevent
        />
        <!-- draggable divider -->
        <div
          class="absolute bottom-0 top-0 z-10 w-[3px] -translate-x-1/2 cursor-col-resize bg-[var(--accent)] shadow-[0_0_12px_var(--accent)]"
          :style="{ left: `${splitPct}%` }"
          data-divider="1"
          @mousedown.stop.prevent="startDrag"
        >
          <div
            class="absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-[var(--accent)] shadow-[0_0_18px_rgba(109,212,236,0.7)]"
          ></div>
        </div>
      </div>

      <div
        v-if="
          sourceError ||
          outputError ||
          sourceLikelyUnsupported ||
          outputLikelyUnsupported
        "
        class="border-t border-[rgba(242,125,145,0.28)] bg-[rgba(242,125,145,0.08)] px-5 py-3 text-[0.86rem] text-[var(--text-muted)]"
      >
        <p class="m-0 font-semibold text-[var(--danger)]">
          Browser playback compatibility issue detected.
        </p>
        <p class="mb-0 mt-1">
          {{
            sourceError ||
            outputError ||
            "This browser may not decode one of these streams directly."
          }}
        </p>
        <p class="mb-0 mt-2">
          Try Safari for HEVC support, or open/download the files in a desktop
          player such as VLC.
        </p>
        <div class="mt-2 flex flex-wrap gap-2.5">
          <a
            class="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[0.8rem] font-semibold text-[var(--text)]"
            :href="sourceUrl"
            target="_blank"
            rel="noreferrer"
            >Open Source Stream</a
          >
          <a
            class="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[0.8rem] font-semibold text-[var(--text)]"
            :href="outputUrl"
            target="_blank"
            rel="noreferrer"
            >Open Output Stream</a
          >
        </div>
      </div>

      <div
        class="flex items-center gap-3.5 border-t border-white/10 px-5 py-3.5"
      >
        <button
          class="h-[38px] w-[38px] shrink-0 rounded-full bg-white/[0.06] text-base text-[var(--text)] transition-colors hover:bg-[rgba(109,212,236,0.2)]"
          type="button"
          @click="togglePlay"
        >
          {{ isPlaying ? "⏸" : "▶" }}
        </button>
        <span
          class="whitespace-nowrap font-mono text-[0.84rem] text-[var(--text-muted)]"
          >{{ fmt(currentTime) }} / {{ fmt(duration) }}</span
        >
        <div class="flex items-center gap-2">
          <button
            class="h-[34px] w-[34px] rounded-full bg-white/[0.06] text-[var(--text)] transition-colors hover:bg-[rgba(109,212,236,0.2)]"
            type="button"
            @click="zoomOut"
          >
            −
          </button>
          <input
            class="h-2 w-[120px] cursor-pointer accent-[var(--accent)]"
            type="range"
            min="1"
            max="4"
            step="0.05"
            :value="zoom"
            @input="onZoomInput"
          />
          <button
            class="h-[34px] w-[34px] rounded-full bg-white/[0.06] text-[var(--text)] transition-colors hover:bg-[rgba(109,212,236,0.2)]"
            type="button"
            @click="zoomIn"
          >
            +
          </button>
          <button
            class="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[0.8rem] font-semibold text-[var(--text)]"
            type="button"
            @click="resetView"
          >
            {{ zoomPercent }}% Reset
          </button>
        </div>
        <input
          class="h-2 flex-1 cursor-pointer accent-[var(--accent)]"
          type="range"
          :min="0"
          :max="duration || 1"
          :step="0.1"
          :value="currentTime"
          @input="onScrubberInput"
        />
      </div>
    </div>
  </div>
</template>
