<script setup lang="ts">
import { ref, onMounted } from "vue";
import VideoCompare from "../components/VideoCompare.vue";
import type { HistoryEntry, StatsTotals } from "../types.ts";

interface HistoryPayload {
  total: number;
  items: HistoryEntry[];
  totals: StatsTotals;
}

const history = ref<HistoryEntry[]>([]);
const totals = ref<StatsTotals>({
  processed: 0,
  succeeded: 0,
  failed: 0,
  inputBytes: 0,
  outputBytes: 0,
  savedBytes: 0,
  avgSavedPercent: 0,
});
const totalCount = ref(0);
const loading = ref(false);

const comparing = ref<{ sourcePath: string; outputPath: string } | null>(null);

function formatBytes(v: number): string {
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(2)} GB`;
  if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(2)} MB`;
  if (v >= 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${v} B`;
}

function formatDate(s: string): string {
  return new Date(s).toLocaleString();
}

function outputPathFor(relativePath: string): string {
  const { dir, name } = (() => {
    const parts = relativePath.split("/");
    const file = parts.pop() ?? "";
    const dotIdx = file.lastIndexOf(".");
    return {
      dir: parts.join("/"),
      name: dotIdx > 0 ? file.slice(0, dotIdx) : file,
    };
  })();
  return dir ? `${dir}/${name}.mkv` : `${name}.mkv`;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await fetch("/api/history?limit=500");
    const data = (await res.json()) as HistoryPayload;
    history.value = data.items;
    totals.value = data.totals;
    totalCount.value = data.total;
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
          All completed transcodes with per-file savings.
        </p>
      </div>
      <p class="text-[var(--text-muted)]">{{ totalCount }} total</p>
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

    <div
      v-else-if="!history.length"
      class="rounded-[22px] border border-dashed border-[rgba(109,212,236,0.16)] bg-white/[0.025] px-4 py-10 text-center text-[var(--text-muted)]"
    >
      No transcodes yet.
    </div>

    <div v-else class="grid gap-3.5">
      <article
        v-for="item in history"
        :key="`${item.timestamp}-${item.relativePath}`"
        class="rounded-[22px] border border-white/10 bg-white/[0.035] px-4 py-3.5"
      >
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <p
              class="m-0 text-[0.72rem] font-bold uppercase tracking-[0.16em]"
              :class="
                item.status === 'failed'
                  ? 'text-[var(--danger)]'
                  : 'text-[var(--success)]'
              "
            >
              {{ item.status }}
            </p>
            <h3
              :title="item.relativePath"
              class="mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-base font-bold tracking-[-0.02em]"
            >
              {{ item.relativePath.split("/").pop() }}
            </h3>
            <p
              class="mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap text-[0.8rem] text-[var(--text-muted)]"
            >
              {{ item.relativePath }}
            </p>
          </div>
          <div class="shrink-0 text-right">
            <p
              class="whitespace-nowrap font-mono text-[0.9rem] font-bold text-[var(--accent)]"
            >
              {{ item.savedPercent.toFixed(1) }}%
            </p>
            <p class="text-[0.82rem] text-[var(--text-muted)]">
              saved {{ formatBytes(item.savedBytes) }}
            </p>
            <button
              v-if="item.status === 'succeeded'"
              class="mt-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-[0.84rem] font-extrabold text-[var(--text)] transition-transform hover:-translate-y-0.5"
              type="button"
              @click="
                comparing = {
                  sourcePath: item.relativePath,
                  outputPath: outputPathFor(item.relativePath),
                }
              "
            >
              Compare
            </button>
          </div>
        </div>
        <div
          class="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[0.88rem] text-[var(--text-muted)]"
        >
          <span>In {{ formatBytes(item.inputBytes) }}</span>
          <span>Out {{ formatBytes(item.outputBytes) }}</span>
          <span>QP {{ item.qp }} · {{ item.method }}</span>
          <span>{{ formatDate(item.timestamp) }}</span>
        </div>
      </article>
    </div>
  </div>

  <VideoCompare
    v-if="comparing"
    :source-path="comparing.sourcePath"
    :output-path="comparing.outputPath"
    @close="comparing = null"
  />
</template>
