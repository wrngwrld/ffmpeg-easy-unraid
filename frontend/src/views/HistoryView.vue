<script setup lang="ts">
import { ref, onMounted } from "vue";
import type { StatsTotals } from "../types.ts";

interface HistoryPayload {
  totals: StatsTotals;
}

const totals = ref<StatsTotals>({
  processed: 0,
  succeeded: 0,
  failed: 0,
  inputBytes: 0,
  outputBytes: 0,
  savedBytes: 0,
  avgSavedPercent: 0,
});
const loading = ref(false);

function formatBytes(v: number): string {
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(2)} GB`;
  if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(2)} MB`;
  if (v >= 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${v} B`;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await fetch("/api/history?limit=500");
    const data = (await res.json()) as HistoryPayload;
    totals.value = data.totals;
  } catch {
    /* non-fatal */
  }
  loading.value = false;
}

onMounted(load);
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
          >History
        </div>
        <h2 class="m-0 text-[1.7rem] font-black tracking-[-0.04em]">
          Transcode History
        </h2>
        <p class="mt-2 max-w-[44ch] text-[0.94rem] text-[var(--text-muted)]">
          Aggregated results across all completed transcodes.
        </p>
      </div>
    </div>

    <div class="mb-6 grid grid-cols-4 gap-3 max-[900px]:grid-cols-2">
      <article
        class="rounded-[18px] border border-[rgba(109,212,236,0.1)] bg-white/[0.04] p-5 backdrop-blur-[14px]"
      >
        <p
          class="m-0 text-[0.72rem] font-bold uppercase tracking-[0.16em] text-[var(--text-dim)]"
        >
          Total Saved
        </p>
        <p
          class="mt-3 font-mono text-[1.4rem] font-extrabold text-[var(--text)]"
        >
          {{ formatBytes(totals.savedBytes) }}
        </p>
      </article>
      <article
        class="rounded-[18px] border border-[rgba(109,212,236,0.1)] bg-white/[0.04] p-5 backdrop-blur-[14px]"
      >
        <p
          class="m-0 text-[0.72rem] font-bold uppercase tracking-[0.16em] text-[var(--text-dim)]"
        >
          Avg Saved
        </p>
        <p
          class="mt-3 font-mono text-[1.4rem] font-extrabold text-[var(--text)]"
        >
          {{ totals.avgSavedPercent.toFixed(1) }}%
        </p>
      </article>
      <article
        class="rounded-[18px] border border-[rgba(109,212,236,0.1)] bg-white/[0.04] p-5 backdrop-blur-[14px]"
      >
        <p
          class="m-0 text-[0.72rem] font-bold uppercase tracking-[0.16em] text-[var(--text-dim)]"
        >
          Succeeded
        </p>
        <p
          class="mt-3 font-mono text-[1.4rem] font-extrabold text-[var(--text)]"
        >
          {{ totals.succeeded }}
        </p>
      </article>
      <article
        class="rounded-[18px] border border-[rgba(109,212,236,0.1)] bg-white/[0.04] p-5 backdrop-blur-[14px]"
      >
        <p
          class="m-0 text-[0.72rem] font-bold uppercase tracking-[0.16em] text-[var(--text-dim)]"
        >
          Failed
        </p>
        <p
          class="mt-3 font-mono text-[1.4rem] font-extrabold text-[var(--text)]"
        >
          {{ totals.failed }}
        </p>
      </article>
    </div>

    <div
      v-if="loading"
      class="rounded-[22px] border border-dashed border-[rgba(109,212,236,0.16)] bg-white/[0.025] px-4 py-10 text-center text-[var(--text-muted)]"
    >
      Loading…
    </div>
  </div>
</template>
