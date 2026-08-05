<script setup lang="ts">
import { computed } from "vue";
import { useQueueStore } from "../stores/queue.ts";
import type { Job } from "../types.ts";

const props = defineProps<{ job: Job; queuedPosition?: number }>();
defineEmits<{ compare: [job: Job] }>();
const queue = useQueueStore();

function formatBytes(v: number | null): string {
  if (!v) return "0 B";
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(2)} GB`;
  if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(2)} MB`;
  return `${(v / 1024).toFixed(0)} KB`;
}

const stateClass = computed(
  () =>
    ({
      running: "text-[var(--accent)]",
      queued: "text-[var(--warn)]",
      done: "text-[var(--success)]",
      failed: "text-[var(--danger)]",
      cancelled: "text-[var(--text-dim)]",
    })[props.job.state] ?? "",
);

const barFillStyle = computed(() => {
  const pct = Math.max(0, Math.min(100, props.job.pct));
  return {
    width: `${pct}%`,
    background: "var(--bar)",
  };
});

const filename = computed(() => {
  const parts = props.job.sourcePath.split("/");
  return parts[parts.length - 1] ?? props.job.sourcePath;
});

const queuedLabel = computed(() => {
  if (props.job.state !== "queued") return null;
  if (!props.queuedPosition || props.queuedPosition < 1) return "Queued";
  return `Queued #${props.queuedPosition}`;
});

const etaSeconds = computed(() => {
  if (props.job.state !== "running") return null;
  if (!Number.isFinite(props.job.elapsed) || props.job.elapsed <= 0)
    return null;
  if (
    !Number.isFinite(props.job.pct) ||
    props.job.pct <= 0 ||
    props.job.pct >= 100
  ) {
    return null;
  }
  return Math.round(
    (props.job.elapsed * (100 - props.job.pct)) / props.job.pct,
  );
});

function fmtDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "n/a";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "n/a";
  return d.toLocaleTimeString();
}

function encoderLabel(job: Job): string {
  return job.encoder === "vaapi"
    ? "VAAPI"
    : job.encoder === "videotoolbox"
      ? "VideoToolbox"
      : "Software";
}

function streamLabel(job: Job): string {
  return job.streamSelection === "primary" ? "Primary A/V" : "All streams";
}

function audioLabel(job: Job): string {
  return job.audioMode === "aac" ? "AAC" : "Copy";
}

function subtitleLabel(job: Job): string {
  return job.subtitleMode === "drop" ? "Drop" : "Copy";
}
</script>

<template>
  <article
    class="rounded-[22px] border border-white/10 bg-white/[0.035] p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-[#6dd4ec]/30 hover:bg-[#6dd4ec]/[0.055]"
  >
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <p
          class="m-0 text-[0.72rem] font-bold uppercase tracking-[0.16em]"
          :class="stateClass"
        >
          {{ queuedLabel ?? job.state }}
        </p>
        <h3
          :title="job.sourcePath"
          class="mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-base font-bold tracking-[-0.02em]"
        >
          {{ filename }}
        </h3>
        <p
          class="mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap text-[0.8rem] text-[var(--text-muted)]"
        >
          {{ job.sourcePath }}
        </p>
      </div>
      <div class="flex shrink-0 items-start gap-2">
        <button
          v-if="job.state === 'done'"
          class="rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-[0.84rem] font-extrabold text-[var(--text)] transition-transform duration-300 hover:-translate-y-0.5"
          type="button"
          @click="$emit('compare', job)"
        >
          Compare
        </button>
        <button
          v-if="job.state === 'running' || job.state === 'queued'"
          class="rounded-full border border-[rgba(242,125,145,0.18)] bg-[rgba(242,125,145,0.08)] px-3.5 py-2 text-[0.84rem] font-extrabold text-[var(--danger)] transition-transform duration-300 hover:-translate-y-0.5"
          type="button"
          @click="queue.cancel(job.id)"
        >
          Cancel
        </button>
      </div>
    </div>

    <template v-if="job.state === 'running'">
      <div class="mt-3 h-2.5 overflow-hidden rounded-full bg-white/10">
        <div
          class="h-full rounded-full shadow-[0_0_20px_rgba(109,212,236,0.3)] transition-all duration-300"
          :style="barFillStyle"
        ></div>
      </div>
      <div class="mt-2.5 flex gap-3.5 text-[0.88rem] text-[var(--text-muted)]">
        <span>{{ job.pct.toFixed(1) }}%</span>
        <span class="font-mono font-bold text-[var(--accent)]">{{
          job.speed
        }}</span>
        <span>{{ job.elapsed }}s elapsed</span>
        <span v-if="etaSeconds !== null"
          >~{{ fmtDuration(etaSeconds) }} left</span
        >
      </div>
    </template>

    <div
      class="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[0.82rem] text-[var(--text-dim)]"
    >
      <span>QP {{ job.qp }}</span>
      <span>{{ encoderLabel(job) }}</span>
      <span>{{ streamLabel(job) }}</span>
      <span>Audio {{ audioLabel(job) }}</span>
      <span>Subs {{ subtitleLabel(job) }}</span>
      <span>Created {{ formatTime(job.createdAt) }}</span>
      <span v-if="job.startedAt">Started {{ formatTime(job.startedAt) }}</span>
      <span v-if="job.finishedAt"
        >Finished {{ formatTime(job.finishedAt) }}</span
      >
    </div>

    <p
      class="mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-[0.8rem] text-[var(--text-dim)]"
      :title="job.outputPath"
    >
      Output: {{ job.outputPath }}
    </p>

    <template v-if="job.state === 'done'">
      <div
        class="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[0.88rem] text-[var(--text-muted)]"
      >
        <span>In {{ formatBytes(job.inputBytes) }}</span>
        <span>Out {{ formatBytes(job.outputBytes) }}</span>
        <span class="font-bold text-[var(--success)]"
          >↓ {{ job.savedPercent?.toFixed(1) }}% saved ({{
            formatBytes(job.savedBytes)
          }})</span
        >
      </div>
    </template>

    <template v-if="job.state === 'failed'">
      <p class="mt-2.5 font-mono text-[0.88rem] text-[var(--danger)]">
        {{ job.error }}
      </p>
    </template>
  </article>
</template>
