<script setup lang="ts">
import { computed, ref } from "vue";
import JobCard from "../components/JobCard.vue";
import { useQueueStore } from "../stores/queue.ts";
import { useStatusStore } from "../stores/status.ts";
import type { Batch, Job } from "../types.ts";

const queue = useQueueStore();
const status = useStatusStore();

const runningCount = computed(
  () => queue.activeJobs.filter((j) => j.state === "running").length,
);
const queuedCount = computed(() => queue.queuedJobs.length);
const queuedPositions = computed(
  () => new Map(queue.queuedJobs.map((job, idx) => [job.id, idx + 1])),
);

interface BatchGroup {
  id: string;
  batch: Batch | null;
  jobs: Job[];
  runningCount: number;
  queuedCount: number;
  totalJobs: number;
  doneCount: number;
  failedCount: number;
  remainingCount: number;
  donePct: number;
  failedPct: number;
}

const batchBusyMap = ref<Record<string, boolean>>({});
const batchActionMsg = ref<string | null>(null);
const batchActionErr = ref<string | null>(null);

const batchById = computed(
  () => new Map(status.batches.map((batch) => [batch.id, batch] as const)),
);

const jobsById = computed(
  () => new Map(status.jobs.map((job) => [job.id, job] as const)),
);

const activeBatchGroups = computed<BatchGroup[]>(() => {
  const groups = new Map<string, BatchGroup>();

  for (const job of queue.activeJobs) {
    const key = job.batchId || `legacy:${job.id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.jobs.push(job);
      if (job.state === "running") existing.runningCount += 1;
      if (job.state === "queued") existing.queuedCount += 1;
      continue;
    }

    groups.set(key, {
      id: key,
      batch: batchById.value.get(job.batchId) ?? null,
      jobs: [job],
      runningCount: job.state === "running" ? 1 : 0,
      queuedCount: job.state === "queued" ? 1 : 0,
      totalJobs: 0,
      doneCount: 0,
      failedCount: 0,
      remainingCount: 0,
      donePct: 0,
      failedPct: 0,
    });
  }

  for (const group of groups.values()) {
    const relatedJobs = group.batch
      ? group.batch.jobIds
          .map((id) => jobsById.value.get(id))
          .filter((job): job is Job => Boolean(job))
      : group.jobs;

    const totalJobs =
      group.batch && group.batch.jobIds.length > 0
        ? group.batch.jobIds.length
        : relatedJobs.length;

    let doneCount = 0;
    let failedCount = 0;
    for (const job of relatedJobs) {
      if (job.state === "done") doneCount += 1;
      if (job.state === "failed" || job.state === "cancelled") failedCount += 1;
    }

    const remainingCount = Math.max(0, totalJobs - doneCount - failedCount);
    const donePct = totalJobs > 0 ? (doneCount / totalJobs) * 100 : 0;
    const failedPct = totalJobs > 0 ? (failedCount / totalJobs) * 100 : 0;

    group.totalJobs = totalJobs;
    group.doneCount = doneCount;
    group.failedCount = failedCount;
    group.remainingCount = remainingCount;
    group.donePct = donePct;
    group.failedPct = failedPct;
  }

  return [...groups.values()].sort((a, b) => {
    const aCreated = a.batch
      ? new Date(a.batch.createdAt).getTime()
      : new Date(a.jobs[0]?.createdAt ?? 0).getTime();
    const bCreated = b.batch
      ? new Date(b.batch.createdAt).getTime()
      : new Date(b.jobs[0]?.createdAt ?? 0).getTime();
    return bCreated - aCreated;
  });
});

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

function encoderLabel(enc: Batch["options"]["encoder"]): string {
  return enc === "vaapi"
    ? "VAAPI"
    : enc === "videotoolbox"
      ? "VideoToolbox"
      : "Software";
}

function streamLabel(mode: Batch["options"]["streamSelection"]): string {
  return mode === "primary" ? "Primary A/V" : "All Streams";
}

function audioLabel(mode: Batch["options"]["audioMode"]): string {
  return mode === "aac" ? "AAC" : "Copy";
}

function subtitleLabel(mode: Batch["options"]["subtitleMode"]): string {
  return mode === "drop" ? "Drop" : "Copy";
}

function confirmCancelRemaining(group: BatchGroup): boolean {
  if (typeof window === "undefined") return true;
  const label = group.batch?.name ?? "this batch";
  const queued = group.queuedCount;
  return window.confirm(
    `Cancel ${queued} queued item${queued === 1 ? "" : "s"} in \"${label}\"? Running jobs will continue.`,
  );
}

async function pauseBatch(batchId: string): Promise<void> {
  batchBusyMap.value[batchId] = true;
  batchActionErr.value = null;
  batchActionMsg.value = null;
  try {
    await queue.pauseBatch(batchId);
    batchActionMsg.value = "Batch paused.";
  } catch (err) {
    batchActionErr.value = err instanceof Error ? err.message : String(err);
  } finally {
    batchBusyMap.value[batchId] = false;
  }
}

async function resumeBatch(batchId: string): Promise<void> {
  batchBusyMap.value[batchId] = true;
  batchActionErr.value = null;
  batchActionMsg.value = null;
  try {
    await queue.resumeBatch(batchId);
    batchActionMsg.value = "Batch resumed.";
  } catch (err) {
    batchActionErr.value = err instanceof Error ? err.message : String(err);
  } finally {
    batchBusyMap.value[batchId] = false;
  }
}

async function cancelRemaining(group: BatchGroup): Promise<void> {
  if (!group.batch) return;
  if (!confirmCancelRemaining(group)) return;

  const batchId = group.batch.id;
  batchBusyMap.value[batchId] = true;
  batchActionErr.value = null;
  batchActionMsg.value = null;
  try {
    const cancelled = await queue.cancelRemainingInBatch(batchId);
    batchActionMsg.value = `Cancelled ${cancelled} queued item${cancelled === 1 ? "" : "s"} in batch.`;
  } catch (err) {
    batchActionErr.value = err instanceof Error ? err.message : String(err);
  } finally {
    batchBusyMap.value[batchId] = false;
  }
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
          Running and waiting jobs grouped by batch.
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

      <div class="grid gap-4">
        <article
          v-for="group in activeBatchGroups"
          :key="group.id"
          class="rounded-[22px] border border-white/10 bg-white/[0.02] p-4"
        >
          <div
            class="mb-3.5 flex flex-wrap items-start justify-between gap-2.5 border-b border-white/10 pb-3"
          >
            <div class="min-w-0">
              <p
                class="m-0 text-[0.7rem] font-bold uppercase tracking-[0.14em] text-[var(--accent)]"
              >
                Batch
              </p>
              <h4
                class="mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-[1rem] font-extrabold"
                :title="group.batch?.name ?? group.jobs[0]?.sourcePath"
              >
                {{ group.batch?.name ?? "Legacy Batch" }}
              </h4>
              <p
                class="mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap text-[0.8rem] text-[var(--text-muted)]"
              >
                {{ group.batch?.sourcePath ?? group.jobs[0]?.sourcePath }}
              </p>
              <p
                v-if="group.batch?.paused"
                class="mt-1 text-[0.76rem] font-bold uppercase tracking-[0.12em] text-[var(--warn)]"
              >
                Paused
              </p>
            </div>
            <div class="text-right text-[0.8rem] text-[var(--text-muted)]">
              <p class="m-0">{{ group.runningCount }} running</p>
              <p class="m-0">{{ group.queuedCount }} queued</p>
            </div>
          </div>

          <div
            class="mb-3 rounded-full bg-white/10 h-2 overflow-hidden"
            :title="`${group.doneCount} done, ${group.failedCount} failed, ${group.remainingCount} remaining`"
          >
            <div class="flex h-full w-full">
              <div
                class="h-full bg-[var(--success)]"
                :style="{ width: `${group.donePct}%` }"
              ></div>
              <div
                class="h-full bg-[var(--danger)]"
                :style="{ width: `${group.failedPct}%` }"
              ></div>
              <div
                class="h-full bg-white/15"
                :style="{
                  width: `${Math.max(0, 100 - group.donePct - group.failedPct)}%`,
                }"
              ></div>
            </div>
          </div>

          <div
            class="mb-3 flex flex-wrap gap-x-3.5 gap-y-1 text-[0.8rem] text-[var(--text-dim)]"
          >
            <span>{{ group.doneCount }} done</span>
            <span>{{ group.failedCount }} failed</span>
            <span>{{ group.remainingCount }} remaining</span>
            <span>{{ group.totalJobs }} total</span>
          </div>

          <div
            v-if="group.batch"
            class="mb-3 flex flex-wrap gap-x-3.5 gap-y-1 text-[0.8rem] text-[var(--text-dim)]"
          >
            <span>QP {{ group.batch.options.qp }}</span>
            <span>{{ encoderLabel(group.batch.options.encoder) }}</span>
            <span>{{ streamLabel(group.batch.options.streamSelection) }}</span>
            <span>Audio {{ audioLabel(group.batch.options.audioMode) }}</span>
            <span
              >Subs {{ subtitleLabel(group.batch.options.subtitleMode) }}</span
            >
          </div>

          <div v-if="group.batch" class="mb-3 flex flex-wrap gap-2">
            <button
              class="rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-[0.78rem] font-bold text-[var(--text)] disabled:opacity-55"
              type="button"
              :disabled="batchBusyMap[group.batch.id]"
              @click="
                group.batch.paused
                  ? resumeBatch(group.batch.id)
                  : pauseBatch(group.batch.id)
              "
            >
              {{
                batchBusyMap[group.batch.id]
                  ? "Working..."
                  : group.batch.paused
                    ? "Resume Batch"
                    : "Pause Batch"
              }}
            </button>
            <button
              class="rounded-full border border-[rgba(242,125,145,0.2)] bg-[rgba(242,125,145,0.08)] px-3.5 py-2 text-[0.78rem] font-bold text-[var(--danger)] disabled:opacity-55"
              type="button"
              :disabled="batchBusyMap[group.batch.id] || group.queuedCount < 1"
              @click="cancelRemaining(group)"
            >
              Cancel Remaining
            </button>
          </div>

          <div class="grid gap-3">
            <JobCard
              v-for="job in group.jobs"
              :key="job.id"
              :job="job"
              :queued-position="queuedPositions.get(job.id)"
            />
          </div>
        </article>
      </div>

      <p
        v-if="batchActionMsg"
        class="mt-3 mb-0 text-[0.86rem] text-[var(--success)]"
      >
        {{ batchActionMsg }}
      </p>
      <p
        v-if="batchActionErr"
        class="mt-3 mb-0 text-[0.86rem] text-[var(--danger)]"
      >
        {{ batchActionErr }}
      </p>
    </section>

    <div
      v-if="!queue.activeJobs.length"
      class="rounded-[22px] border border-dashed border-[rgba(109,212,236,0.16)] bg-white/[0.025] px-4 py-10 text-center text-[var(--text-muted)]"
    >
      No queued or running jobs right now.
    </div>
  </div>
</template>
