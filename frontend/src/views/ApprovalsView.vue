<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import VideoCompare from "../components/VideoCompare.vue";
import type { ApprovalItem } from "../types.ts";

interface ApprovalsPayload {
  total: number;
  items: ApprovalItem[];
}

interface ReplaceAllPayload {
  replaced: number;
  failed: number;
  failures?: Array<{ id: string; sourcePath: string; error: string }>;
}

const loading = ref(false);
const replacingAll = ref(false);
const approvals = ref<ApprovalItem[]>([]);
const errorMsg = ref<string | null>(null);
const infoMsg = ref<string | null>(null);
const rowBusy = ref<Record<string, boolean>>({});
const comparing = ref<{ sourcePath: string; outputPath: string } | null>(null);

const pendingCount = computed(() => approvals.value.length);

function formatDate(s: string): string {
  return new Date(s).toLocaleString();
}

function formatBytes(v: number | null): string {
  if (!v || v <= 0) return "n/a";
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(2)} GB`;
  if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(2)} MB`;
  if (v >= 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${v} B`;
}

function encoderLabel(enc: ApprovalItem["encoder"]): string {
  return enc === "vaapi"
    ? "VAAPI"
    : enc === "videotoolbox"
      ? "VideoToolbox"
      : "Software";
}

async function loadApprovals(): Promise<void> {
  loading.value = true;
  errorMsg.value = null;
  try {
    const res = await fetch("/api/approvals");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as ApprovalsPayload;
    approvals.value = data.items ?? [];
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function replaceOne(item: ApprovalItem): Promise<void> {
  rowBusy.value[item.id] = true;
  errorMsg.value = null;
  infoMsg.value = null;
  try {
    const res = await fetch(`/api/approvals/${item.id}/replace`, {
      method: "POST",
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    approvals.value = approvals.value.filter((x) => x.id !== item.id);
    infoMsg.value = `Replaced source for ${item.sourcePath}.`;
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    rowBusy.value[item.id] = false;
  }
}

async function dismissOne(item: ApprovalItem): Promise<void> {
  rowBusy.value[item.id] = true;
  errorMsg.value = null;
  infoMsg.value = null;
  try {
    const res = await fetch(`/api/approvals/${item.id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 204) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    approvals.value = approvals.value.filter((x) => x.id !== item.id);
    infoMsg.value = `Dismissed ${item.sourcePath}.`;
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    rowBusy.value[item.id] = false;
  }
}

async function replaceAll(): Promise<void> {
  replacingAll.value = true;
  errorMsg.value = null;
  infoMsg.value = null;
  try {
    const res = await fetch("/api/approvals/replace-all", { method: "POST" });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }

    const data = (await res.json()) as ReplaceAllPayload;
    await loadApprovals();
    if ((data.failed ?? 0) > 0) {
      infoMsg.value = `Replaced ${data.replaced} item(s), ${data.failed} failed.`;
    } else {
      infoMsg.value = `Replaced ${data.replaced} item(s).`;
    }
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    replacingAll.value = false;
  }
}

onMounted(loadApprovals);
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
          >Approvals
        </div>
        <h2 class="m-0 text-[1.7rem] font-black tracking-[-0.04em]">
          Pending Replacements
        </h2>
        <p class="mt-2 max-w-[52ch] text-[0.94rem] text-[var(--text-muted)]">
          Review transcoded outputs, compare against source, then approve
          replacement.
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <span
          class="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[0.8rem] text-[var(--text-muted)]"
        >
          {{ pendingCount }} pending
        </span>
        <button
          class="rounded-full border border-[rgba(109,212,236,0.35)] bg-[rgba(109,212,236,0.13)] px-3.5 py-2 text-[0.84rem] font-bold text-[var(--text)] transition-colors hover:bg-[rgba(109,212,236,0.2)] disabled:opacity-50"
          type="button"
          :disabled="replacingAll || !approvals.length"
          @click="replaceAll"
        >
          {{ replacingAll ? "Replacing..." : "Replace All" }}
        </button>
      </div>
    </div>

    <p v-if="infoMsg" class="mb-4 mt-0 text-[0.86rem] text-[var(--success)]">
      {{ infoMsg }}
    </p>
    <p v-if="errorMsg" class="mb-4 mt-0 text-[0.86rem] text-[var(--danger)]">
      {{ errorMsg }}
    </p>

    <div
      v-if="loading"
      class="rounded-[22px] border border-dashed border-[rgba(109,212,236,0.16)] bg-white/[0.025] px-4 py-10 text-center text-[var(--text-muted)]"
    >
      Loading approvals...
    </div>

    <div
      v-else-if="!approvals.length"
      class="rounded-[22px] border border-dashed border-[rgba(109,212,236,0.16)] bg-white/[0.025] px-4 py-10 text-center text-[var(--text-muted)]"
    >
      No pending approvals right now.
    </div>

    <div v-else class="grid gap-3.5">
      <article
        v-for="item in approvals"
        :key="item.id"
        class="rounded-[22px] border border-white/10 bg-white/[0.035] px-4 py-3.5"
      >
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <p
              class="m-0 text-[0.72rem] font-bold uppercase tracking-[0.16em] text-[var(--accent)]"
            >
              Pending Approval
            </p>
            <h3
              :title="item.sourcePath"
              class="mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-base font-bold tracking-[-0.02em]"
            >
              {{ item.sourcePath.split("/").pop() }}
            </h3>
            <p
              class="mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap text-[0.8rem] text-[var(--text-muted)]"
            >
              Source: {{ item.sourcePath }}
            </p>
            <p
              class="mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap text-[0.8rem] text-[var(--text-dim)]"
            >
              Transcoded: {{ item.outputPath }}
            </p>
          </div>
          <div class="shrink-0 text-right">
            <p
              class="whitespace-nowrap font-mono text-[0.9rem] font-bold text-[var(--accent)]"
            >
              {{ item.savedPercent?.toFixed(1) ?? "0.0" }}%
            </p>
            <p class="text-[0.82rem] text-[var(--text-muted)]">
              {{ encoderLabel(item.encoder) }} · QP {{ item.qp }}
            </p>
          </div>
        </div>

        <div
          class="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[0.86rem] text-[var(--text-muted)]"
        >
          <span>Input {{ formatBytes(item.inputBytes) }}</span>
          <span>Output {{ formatBytes(item.outputBytes) }}</span>
          <span>Completed {{ formatDate(item.completedAt) }}</span>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-2.5">
          <button
            class="rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-[0.82rem] font-bold text-[var(--text)] transition-transform hover:-translate-y-0.5"
            type="button"
            @click="
              comparing = {
                sourcePath: item.sourcePath,
                outputPath: item.outputPath,
              }
            "
          >
            Compare
          </button>
          <button
            class="rounded-full border border-[rgba(122,223,154,0.28)] bg-[rgba(122,223,154,0.12)] px-3.5 py-2 text-[0.82rem] font-bold text-[var(--success)] transition-transform hover:-translate-y-0.5 disabled:opacity-55"
            type="button"
            :disabled="rowBusy[item.id]"
            @click="replaceOne(item)"
          >
            {{ rowBusy[item.id] ? "Replacing..." : "Approve & Replace" }}
          </button>
          <button
            class="rounded-full border border-[rgba(242,125,145,0.2)] bg-[rgba(242,125,145,0.08)] px-3.5 py-2 text-[0.82rem] font-bold text-[var(--danger)] transition-transform hover:-translate-y-0.5 disabled:opacity-55"
            type="button"
            :disabled="rowBusy[item.id]"
            @click="dismissOne(item)"
          >
            Dismiss
          </button>
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
