<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import type { FsEntry } from "../types.ts";

const emit = defineEmits<{ select: [path: string, entry: FsEntry] }>();

interface Crumb {
  label: string;
  path: string;
}

const currentPath = ref("/");
const entries = ref<FsEntry[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const breadcrumbs = computed<Crumb[]>(() => {
  const parts = currentPath.value.split("/").filter(Boolean);
  const crumbs: Crumb[] = [{ label: "media", path: "/" }];
  let acc = "";
  for (const p of parts) {
    acc += `/${p}`;
    crumbs.push({ label: p, path: acc });
  }
  return crumbs;
});

async function navigate(p: string): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await fetch(`/api/fs?path=${encodeURIComponent(p)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { path: string; entries: FsEntry[] };
    entries.value = data.entries;
    currentPath.value = data.path;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load";
  } finally {
    loading.value = false;
  }
}

function enterDir(name: string): void {
  navigate(
    currentPath.value === "/" ? `/${name}` : `${currentPath.value}/${name}`,
  );
}

function pick(entry: FsEntry): void {
  const filePath =
    currentPath.value === "/"
      ? `/${entry.name}`
      : `${currentPath.value}/${entry.name}`;
  emit("select", filePath, entry);
}

function queueDirectory(entry: FsEntry): void {
  const dirPath =
    currentPath.value === "/"
      ? `/${entry.name}`
      : `${currentPath.value}/${entry.name}`;
  emit("select", dirPath, entry);
}

function formatSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

onMounted(() => navigate("/"));
</script>

<template>
  <div class="grid gap-3">
    <nav class="flex flex-wrap items-center gap-1">
      <button
        v-for="(crumb, i) in breadcrumbs"
        :key="crumb.path"
        class="rounded-lg px-2 py-1 text-[0.86rem] transition-colors"
        :class="
          i === breadcrumbs.length - 1
            ? 'font-bold text-[var(--accent)]'
            : 'text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text)]'
        "
        @click="navigate(crumb.path)"
      >
        {{ crumb.label
        }}<span
          v-if="i < breadcrumbs.length - 1"
          class="ml-1 text-[var(--text-dim)]"
          >/</span
        >
      </button>
    </nav>

    <div v-if="loading" class="py-7 text-[0.94rem] text-[var(--text-muted)]">
      Loading…
    </div>
    <div v-else-if="error" class="py-7 text-[0.94rem] text-[var(--danger)]">
      {{ error }}
    </div>
    <div
      v-else-if="!entries.length"
      class="py-7 text-[0.94rem] text-[var(--text-muted)]"
    >
      No media files in this folder.
    </div>

    <ul v-else class="m-0 grid list-none gap-1 p-0">
      <li
        v-for="entry in entries"
        :key="entry.name"
        class="flex cursor-pointer items-center gap-2.5 rounded-[14px] border border-transparent px-3.5 py-3 text-[0.92rem] transition-colors hover:border-[rgba(109,212,236,0.14)] hover:bg-[rgba(109,212,236,0.06)]"
        :class="entry.type === 'directory' ? 'text-[var(--accent)]' : ''"
        @click="entry.type === 'directory' ? enterDir(entry.name) : pick(entry)"
      >
        <span class="shrink-0 text-[1.1em]">{{
          entry.type === "directory" ? "📁" : "🎬"
        }}</span>
        <span
          class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
          >{{ entry.name }}</span
        >
        <span
          v-if="entry.ext"
          class="shrink-0 rounded-full border border-[rgba(109,212,236,0.2)] bg-[rgba(109,212,236,0.1)] px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-[0.08em] text-[var(--accent)]"
          >{{ entry.ext.replace(".", "") }}</span
        >
        <span
          v-if="entry.sizeBytes"
          class="shrink-0 font-mono text-[0.82rem] text-[var(--text-dim)]"
          >{{ formatSize(entry.sizeBytes) }}</span
        >
        <button
          v-if="entry.type === 'directory'"
          type="button"
          class="shrink-0 rounded-full border border-[rgba(109,212,236,0.24)] bg-[rgba(109,212,236,0.12)] px-2.5 py-1 text-[0.72rem] font-bold uppercase tracking-[0.08em] text-[var(--accent)] hover:bg-[rgba(109,212,236,0.2)]"
          @click.stop="queueDirectory(entry)"
        >
          Queue Folder
        </button>
      </li>
    </ul>
  </div>
</template>
