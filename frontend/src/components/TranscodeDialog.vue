<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useQueueStore } from "../stores/queue.ts";
import { useStatusStore } from "../stores/status.ts";
import type { FsEntry, EncoderChoice } from "../types.ts";

const props = defineProps<{ path: string; entry: FsEntry }>();
const emit = defineEmits<{ close: []; submitted: [] }>();

const queue = useQueueStore();
const status = useStatusStore();

const qp = ref(22);
const encoder = ref<EncoderChoice>("vaapi");
const submitting = ref(false);
const errorMsg = ref<string | null>(null);
const successMsg = ref<string | null>(null);

const canVaapi = computed(() => status.availableEncoders.includes("vaapi"));
const canVideoToolbox = computed(() =>
  status.availableEncoders.includes("videotoolbox"),
);
const isDirectory = computed(() => props.entry.type === "directory");

watch(
  () => status.availableEncoders,
  (encoders) => {
    if (encoders.includes("vaapi")) {
      encoder.value = "vaapi";
      return;
    }
    if (encoders.includes("videotoolbox")) {
      encoder.value = "videotoolbox";
      return;
    }
    encoder.value = "software";
  },
  { immediate: true },
);

function formatSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

async function submit(): Promise<void> {
  submitting.value = true;
  errorMsg.value = null;
  successMsg.value = null;
  try {
    if (isDirectory.value) {
      const queued = await queue.submitFolder(
        props.path,
        qp.value,
        encoder.value,
      );
      successMsg.value = `Queued ${queued} file${queued === 1 ? "" : "s"}.`;
      emit("submitted");
      emit("close");
      return;
    }

    await queue.submit(props.path, qp.value, encoder.value);
    successMsg.value = "Queued 1 file.";
    emit("submitted");
    emit("close");
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : "Failed to queue job";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div
    class="fixed inset-0 z-[200] flex items-center justify-center bg-black/65 p-6 backdrop-blur-[6px]"
    @click.self="$emit('close')"
  >
    <div
      class="relative w-[min(560px,100%)] rounded-[28px] border border-[var(--border)] bg-[var(--glass-strong)] p-8 shadow-[var(--shadow-deep)] backdrop-blur-[24px] max-[760px]:p-[22px]"
    >
      <header class="mb-6">
        <div
          class="mb-3 inline-flex items-center gap-2 rounded-full border border-[rgba(109,212,236,0.22)] bg-[rgba(109,212,236,0.1)] px-3.5 py-1.5 text-[0.72rem] font-extrabold uppercase tracking-[0.12em] text-[var(--accent)]"
        >
          <span
            class="h-[7px] w-[7px] rounded-full bg-[var(--accent)] shadow-[0_0_18px_rgba(109,212,236,0.6)]"
          ></span
          >Transcode
        </div>
        <h2 class="m-0 text-[1.6rem] font-black tracking-[-0.04em]">
          {{ isDirectory ? "Queue Folder" : "Configure Job" }}
        </h2>
      </header>

      <div
        class="mb-6 flex items-center gap-2.5 rounded-[14px] border border-white/10 bg-white/[0.04] px-4 py-3.5"
      >
        <span class="shrink-0 text-[1.1em]">{{
          isDirectory ? "📁" : "🎬"
        }}</span>
        <span
          class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-semibold"
          :title="path"
          >{{ entry.name }}</span
        >
        <span
          v-if="entry.sizeBytes"
          class="shrink-0 font-mono text-[0.82rem] text-[var(--text-dim)]"
          >{{ formatSize(entry.sizeBytes) }}</span
        >
      </div>

      <div class="mb-[22px]">
        <label
          class="mb-2.5 block text-[0.88rem] font-semibold text-[var(--text-muted)]"
        >
          Quality (QP) — lower = better quality, larger file
        </label>
        <div class="flex items-center gap-3.5">
          <input
            type="range"
            min="0"
            max="51"
            step="1"
            v-model.number="qp"
            class="h-2 flex-1 cursor-pointer accent-[var(--accent)]"
          />
          <span class="min-w-[2.5ch] font-mono text-[1.2rem] font-bold">{{
            qp
          }}</span>
        </div>
        <div
          class="mt-1.5 flex justify-between text-[0.76rem] text-[var(--text-dim)]"
        >
          <span>0 — lossless</span><span>22 — default</span
          ><span>51 — worst</span>
        </div>
      </div>

      <div class="mb-[22px]">
        <label
          class="mb-2.5 block text-[0.88rem] font-semibold text-[var(--text-muted)]"
          >Encoder</label
        >
        <div class="flex gap-2">
          <button
            type="button"
            class="flex-1 rounded-[14px] border px-4 py-3 text-[0.88rem] font-bold transition-all"
            :class="
              encoder === 'vaapi'
                ? 'border-[var(--accent)] bg-[rgba(109,212,236,0.12)] text-[var(--text)]'
                : 'border-white/10 bg-white/[0.03] text-[var(--text-muted)]'
            "
            :disabled="!canVaapi"
            @click="encoder = 'vaapi'"
          >
            Intel VAAPI
            <span
              v-if="!canVaapi"
              class="mt-0.5 block text-[0.7rem] font-normal text-[var(--danger)]"
              >unavailable</span
            >
          </button>
          <button
            type="button"
            class="flex-1 rounded-[14px] border px-4 py-3 text-[0.88rem] font-bold transition-all"
            :class="
              encoder === 'videotoolbox'
                ? 'border-[var(--accent)] bg-[rgba(109,212,236,0.12)] text-[var(--text)]'
                : 'border-white/10 bg-white/[0.03] text-[var(--text-muted)]'
            "
            :disabled="!canVideoToolbox"
            @click="encoder = 'videotoolbox'"
          >
            Apple VideoToolbox
            <span
              v-if="!canVideoToolbox"
              class="mt-0.5 block text-[0.7rem] font-normal text-[var(--danger)]"
              >unavailable</span
            >
          </button>
          <button
            type="button"
            class="flex-1 rounded-[14px] border px-4 py-3 text-[0.88rem] font-bold transition-all"
            :class="
              encoder === 'software'
                ? 'border-[var(--accent)] bg-[rgba(109,212,236,0.12)] text-[var(--text)]'
                : 'border-white/10 bg-white/[0.03] text-[var(--text-muted)]'
            "
            @click="encoder = 'software'"
          >
            Software (libx265)
          </button>
        </div>
      </div>

      <p v-if="successMsg" class="mt-3 text-[0.92rem] text-[var(--success)]">
        {{ successMsg }}
      </p>

      <p v-if="errorMsg" class="mt-3 text-[0.92rem] text-[var(--danger)]">
        {{ errorMsg }}
      </p>

      <footer class="mt-7 flex justify-end gap-3">
        <button
          class="rounded-full border border-white/10 bg-white/[0.04] px-5 py-3 font-extrabold text-[var(--text)] transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-65"
          type="button"
          @click="$emit('close')"
        >
          Cancel
        </button>
        <button
          class="rounded-full bg-[linear-gradient(135deg,var(--accent)_0%,var(--accent-two)_100%)] px-[22px] py-[13px] font-extrabold text-[#08090d] shadow-[0_10px_30px_rgba(109,212,236,0.26)] transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-65"
          type="button"
          :disabled="submitting"
          @click="submit"
        >
          {{
            submitting
              ? "Queuing…"
              : isDirectory
                ? "Queue Folder"
                : "Start Transcode"
          }}
        </button>
      </footer>
    </div>
  </div>
</template>
