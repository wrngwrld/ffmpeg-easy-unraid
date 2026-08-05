<script setup lang="ts">
import { useStatusStore } from "../stores/status.ts";

const status = useStatusStore();
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
  </div>
</template>
