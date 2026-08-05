<script setup lang="ts">
import { ref } from "vue";
import FileBrowser from "../components/FileBrowser.vue";
import TranscodeDialog from "../components/TranscodeDialog.vue";
import type { FsEntry } from "../types.ts";

const selected = ref<{ path: string; entry: FsEntry } | null>(null);

function onSelect(path: string, entry: FsEntry): void {
  selected.value = { path, entry };
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
          >Browse
        </div>
        <h2 class="m-0 text-[1.7rem] font-black tracking-[-0.04em]">
          Pick a File or Folder
        </h2>
        <p class="mt-2 max-w-[44ch] text-[0.94rem] text-[var(--text-muted)]">
          Select a file to queue one job, or use "Queue Folder" to enqueue all
          supported media files recursively.
        </p>
      </div>
    </div>

    <FileBrowser @select="onSelect" />
  </div>

  <TranscodeDialog
    v-if="selected"
    :path="selected.path"
    :entry="selected.entry"
    @close="selected = null"
    @submitted="selected = null"
  />
</template>
