<script setup lang="ts">
import { ref } from "vue";
import JobCard from "../components/JobCard.vue";
import VideoCompare from "../components/VideoCompare.vue";
import { useQueueStore } from "../stores/queue.ts";
import { useStatusStore } from "../stores/status.ts";
import type { Job } from "../types.ts";

const queue = useQueueStore();
const status = useStatusStore();

const comparing = ref<Job | null>(null);
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
          Active and recently completed jobs.
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
          @compare="comparing = $event"
        />
      </div>
    </section>

    <section v-if="queue.completedJobs.length">
      <h3
        class="mb-3 mt-5 text-[0.78rem] font-bold uppercase tracking-[0.14em] text-[var(--text-dim)]"
      >
        Completed
      </h3>
      <div class="grid gap-3.5">
        <JobCard
          v-for="job in queue.completedJobs"
          :key="job.id"
          :job="job"
          @compare="comparing = $event"
        />
      </div>
    </section>

    <div
      v-if="!queue.activeJobs.length && !queue.completedJobs.length"
      class="rounded-[22px] border border-dashed border-[rgba(109,212,236,0.16)] bg-white/[0.025] px-4 py-10 text-center text-[var(--text-muted)]"
    >
      No jobs yet — browse your media library and pick a file to transcode.
    </div>
  </div>

  <VideoCompare
    v-if="comparing"
    :source-path="comparing.sourcePath"
    :output-path="comparing.outputPath"
    @close="comparing = null"
  />
</template>
