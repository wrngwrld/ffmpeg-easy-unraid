<script setup lang="ts">
import { computed, ref } from "vue";
import JobCard from "../components/JobCard.vue";
import VideoCompare from "../components/VideoCompare.vue";
import { useQueueStore } from "../stores/queue.ts";
import { useStatusStore } from "../stores/status.ts";
import type { Job } from "../types.ts";

const queue = useQueueStore();
const status = useStatusStore();

const comparing = ref<Job | null>(null);

const runningCount = computed(
  () => queue.activeJobs.filter((j) => j.state === "running").length,
);
const queuedCount = computed(() => queue.queuedJobs.length);
const queuedPositions = computed(
  () => new Map(queue.queuedJobs.map((job, idx) => [job.id, idx + 1])),
);

function estimateRemainingSeconds(job: Job): number | null {
  if (job.state !== "running") return null;
  if (!Number.isFinite(job.elapsed) || job.elapsed <= 0) return null;
  if (!Number.isFinite(job.pct) || job.pct <= 0 || job.pct >= 100) return null;
  return Math.round((job.elapsed * (100 - job.pct)) / job.pct);
}

const totalRunningEtaSeconds = computed(() =>
  queue.activeJobs
    .map(estimateRemainingSeconds)
    .filter((v): v is number => v !== null)
    .reduce((sum, secs) => sum + secs, 0),
);

function fmtDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}
</script>

<template>
  <div
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
          >Queue
        </div>
        <h2 class="m-0 text-[1.7rem] font-black tracking-[-0.04em]">
          Transcode Queue
        </h2>
        <p class="mt-2 max-w-[44ch] text-[0.94rem] text-[var(--text-muted)]">
          Currently running and waiting jobs.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <span
          class="inline-block h-2 w-2 rounded-full"
          :class="
            status.connected
              ? 'bg-[var(--success)] shadow-[0_0_8px_rgba(122,223,154,0.5)]'
              : 'bg-[var(--danger)]'
          "
        ></span>
        <span class="text-[var(--text-muted)]">{{
          status.connected ? "Live" : "Reconnecting…"
        }}</span>
      </div>
    </div>

    <div class="mb-5 grid grid-cols-3 gap-2.5 max-[900px]:grid-cols-2">
      <article
        class="rounded-[14px] border border-white/10 bg-white/[0.03] px-3.5 py-2.5"
      >
        <p
          class="m-0 text-[0.7rem] font-bold uppercase tracking-[0.14em] text-[var(--text-dim)]"
        >
          Running
        </p>
        <p class="mt-1 text-[1.15rem] font-black">{{ runningCount }}</p>
      </article>
      <article
        class="rounded-[14px] border border-white/10 bg-white/[0.03] px-3.5 py-2.5"
      >
        <p
          class="m-0 text-[0.7rem] font-bold uppercase tracking-[0.14em] text-[var(--text-dim)]"
        >
          Queued
        </p>
        <p class="mt-1 text-[1.15rem] font-black">{{ queuedCount }}</p>
      </article>
      <article
        class="rounded-[14px] border border-white/10 bg-white/[0.03] px-3.5 py-2.5 max-[900px]:col-span-2"
      >
        <p
          class="m-0 text-[0.7rem] font-bold uppercase tracking-[0.14em] text-[var(--text-dim)]"
        >
          Running ETA Sum
        </p>
        <p class="mt-1 text-[1.15rem] font-black">
          {{
            totalRunningEtaSeconds > 0
              ? `~${fmtDuration(totalRunningEtaSeconds)}`
              : "n/a"
          }}
        </p>
      </article>
    </div>

    <section v-if="queue.activeJobs.length">
      <h3
        class="mb-3 text-[0.78rem] font-bold uppercase tracking-[0.14em] text-[var(--text-dim)]"
      >
        Active ({{ queue.activeJobs.length }})
      </h3>
      <div class="grid gap-3.5">
        <JobCard
          v-for="job in queue.activeJobs"
          :key="job.id"
          :job="job"
          :queued-position="queuedPositions.get(job.id)"
          @compare="comparing = $event"
        />
      </div>
    </section>

    <div
      v-if="!queue.activeJobs.length"
      class="rounded-[22px] border border-dashed border-[rgba(109,212,236,0.16)] bg-white/[0.025] px-4 py-10 text-center text-[var(--text-muted)]"
    >
      No queued or running jobs right now.
    </div>
  </div>

  <VideoCompare
    v-if="comparing"
    :source-path="comparing.sourcePath"
    :output-path="comparing.outputPath"
    @close="comparing = null"
  />
</template>
