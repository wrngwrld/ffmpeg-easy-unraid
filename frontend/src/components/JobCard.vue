<script setup lang="ts">
import { computed } from "vue";
import { useQueueStore } from "../stores/queue.ts";
import type { Job } from "../types.ts";

const props = defineProps<{ job: Job }>();
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
          {{ job.state }}
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
      </div>
    </template>

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
