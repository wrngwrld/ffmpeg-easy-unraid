<script setup lang="ts">
import { ref, watch } from "vue";
import { useStatusStore } from "../stores/status.ts";

const status = useStatusStore();

const saving = ref(false);
const saveError = ref<string | null>(null);
const saveOk = ref<string | null>(null);
const draftParallelJobs = ref(status.parallelJobs);

watch(
  () => status.parallelJobs,
  (next) => {
    draftParallelJobs.value = next;
  },
  { immediate: true },
);

async function saveParallelJobs(): Promise<void> {
  saveError.value = null;
  saveOk.value = null;
  saving.value = true;

  try {
    const clamped = Math.max(
      status.settingsLimits.min,
      Math.min(status.settingsLimits.max, Math.floor(draftParallelJobs.value)),
    );
    await status.updateParallelJobs(clamped);
    saveOk.value = "Saved. New queue limit is active immediately.";
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="grid gap-[22px]">
    <article
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
            >System
          </div>
          <h2 class="m-0 text-[1.7rem] font-black tracking-[-0.04em]">
            Hardware Status
          </h2>
        </div>
      </div>
      <dl class="m-0 grid">
        <div
          class="flex justify-between gap-3.5 border-b border-white/10 py-3.5 first:pt-0"
        >
          <dt class="text-[var(--text-muted)]">Intel VAAPI</dt>
          <dd
            class="m-0 font-mono font-bold"
            :style="{
              color: status.availableEncoders.includes('vaapi')
                ? 'var(--success)'
                : 'var(--danger)',
            }"
          >
            {{
              status.availableEncoders.includes("vaapi")
                ? "Available"
                : "Unavailable"
            }}
          </dd>
        </div>
        <div
          class="flex justify-between gap-3.5 border-b border-white/10 py-3.5"
        >
          <dt class="text-[var(--text-muted)]">Apple VideoToolbox</dt>
          <dd
            class="m-0 font-mono font-bold"
            :style="{
              color: status.availableEncoders.includes('videotoolbox')
                ? 'var(--success)'
                : 'var(--danger)',
            }"
          >
            {{
              status.availableEncoders.includes("videotoolbox")
                ? "Available"
                : "Unavailable"
            }}
          </dd>
        </div>
        <div
          class="flex justify-between gap-3.5 border-b border-white/10 py-3.5"
        >
          <dt class="text-[var(--text-muted)]">Software fallback</dt>
          <dd class="m-0 font-mono font-bold text-[var(--success)]">
            libx265 (always available)
          </dd>
        </div>
        <div
          class="flex justify-between gap-3.5 border-b border-white/10 py-3.5"
        >
          <dt class="text-[var(--text-muted)]">SSE connection</dt>
          <dd
            class="m-0 font-mono font-bold"
            :style="{
              color: status.connected ? 'var(--success)' : 'var(--warn)',
            }"
          >
            {{ status.connected ? "Connected" : "Reconnecting…" }}
          </dd>
        </div>
      </dl>
    </article>

    <article
      class="relative rounded-[28px] border border-white/10 bg-[var(--glass)] p-7 shadow-[var(--shadow-deep),var(--shadow-glow)] backdrop-blur-[18px] backdrop-saturate-150 max-[760px]:p-5"
    >
      <div class="mb-5">
        <h2 class="m-0 text-[1.55rem] font-black tracking-[-0.03em]">
          Queue Settings
        </h2>
        <p class="mt-2 text-[0.92rem] text-[var(--text-muted)]">
          Change how many transcodes can run in parallel without restarting the
          container.
        </p>
      </div>

      <div class="grid gap-3.5">
        <label class="text-[0.82rem] font-semibold text-[var(--text-muted)]"
          >Parallel jobs</label
        >
        <div class="flex items-center gap-3">
          <input
            v-model.number="draftParallelJobs"
            class="w-24 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[var(--text)] outline-none focus:border-[rgba(109,212,236,0.35)]"
            type="number"
            :min="status.settingsLimits.min"
            :max="status.settingsLimits.max"
          />
          <button
            class="rounded-full border border-[rgba(109,212,236,0.35)] bg-[rgba(109,212,236,0.13)] px-4 py-2 text-[0.84rem] font-bold text-[var(--text)] transition-colors hover:bg-[rgba(109,212,236,0.2)] disabled:opacity-50"
            type="button"
            :disabled="saving"
            @click="saveParallelJobs"
          >
            {{ saving ? "Saving..." : "Apply" }}
          </button>
        </div>
        <p class="m-0 text-[0.8rem] text-[var(--text-dim)]">
          Allowed range: {{ status.settingsLimits.min }} to
          {{ status.settingsLimits.max }}. Current: {{ status.parallelJobs }}.
        </p>
        <p v-if="saveOk" class="m-0 text-[0.82rem] text-[var(--success)]">
          {{ saveOk }}
        </p>
        <p v-if="saveError" class="m-0 text-[0.82rem] text-[var(--danger)]">
          {{ saveError }}
        </p>
      </div>
    </article>
  </div>
</template>
