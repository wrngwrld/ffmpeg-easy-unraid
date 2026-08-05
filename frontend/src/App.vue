<script setup lang="ts">
import { RouterLink, RouterView } from "vue-router";

const nav = [
  { to: "/browse", label: "Browse" },
  { to: "/queue", label: "Queue" },
  { to: "/history", label: "History" },
  { to: "/system", label: "System" },
];
</script>

<template>
  <div
    class="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(109,212,236,0.08),transparent_24%),radial-gradient(circle_at_80%_0%,rgba(167,139,250,0.08),transparent_28%),linear-gradient(180deg,#08090d_0%,#090b11_100%)]"
  ></div>
  <div
    class="pointer-events-none fixed left-1/2 top-[-120px] h-[480px] w-[480px] -translate-x-[420px] rounded-full bg-[radial-gradient(circle,rgba(109,212,236,0.18)_0%,transparent_70%)] blur-[80px] opacity-95"
    style="animation: orbFloatOne 14s ease-in-out infinite"
  ></div>
  <div
    class="pointer-events-none fixed right-[-80px] top-[16%] h-[380px] w-[380px] rounded-full bg-[radial-gradient(circle,rgba(167,139,250,0.16)_0%,transparent_72%)] blur-[80px] opacity-95"
    style="animation: orbFloatTwo 18s ease-in-out infinite"
  ></div>
  <div
    class="pointer-events-none fixed bottom-[10%] left-[-90px] h-[320px] w-[320px] rounded-full bg-[radial-gradient(circle,rgba(109,212,236,0.1)_0%,transparent_72%)] blur-[80px] opacity-95"
    style="animation: orbFloatOne 22s ease-in-out infinite reverse"
  ></div>

  <nav
    class="sticky top-0 z-50 border-b border-white/10 bg-[rgba(8,9,13,0.72)] px-6 py-4 backdrop-blur-[20px] backdrop-saturate-150"
  >
    <div
      class="mx-auto flex w-[min(1180px,calc(100vw-32px))] items-center justify-between gap-5 max-[760px]:w-[min(100vw-22px,100%)]"
    >
      <RouterLink
        class="inline-flex items-center gap-3 font-extrabold tracking-[-0.02em] text-[var(--text)] no-underline"
        to="/browse"
      >
        <span
          class="inline-flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border border-[rgba(109,212,236,0.18)] bg-[linear-gradient(135deg,rgba(109,212,236,0.24),rgba(167,139,250,0.24))] font-mono text-[0.82rem] text-[var(--accent)]"
          >TH</span
        >
        <span
          >Transcode<span
            class="bg-[linear-gradient(135deg,var(--accent)_0%,var(--accent-two)_100%)] bg-clip-text text-transparent"
            >Harbor</span
          ></span
        >
      </RouterLink>
      <div class="flex gap-2 max-[760px]:overflow-x-auto max-[760px]:pb-0.5">
        <RouterLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          custom
          v-slot="{ href, navigate, isActive }"
        >
          <a
            :href="href"
            @click="navigate"
            class="rounded-full border px-3.5 py-2 text-[0.86rem] font-bold transition-colors"
            :class="
              isActive
                ? 'border-[rgba(109,212,236,0.28)] bg-[rgba(109,212,236,0.1)] text-[var(--text)]'
                : 'border-white/10 bg-white/[0.03] text-[var(--text-muted)] hover:border-[rgba(109,212,236,0.28)] hover:bg-[rgba(109,212,236,0.1)] hover:text-[var(--text)]'
            "
            >{{ item.label }}</a
          >
        </RouterLink>
      </div>
    </div>
  </nav>

  <main
    class="relative mx-auto grid w-[min(1180px,calc(100vw-32px))] gap-[22px] py-7 pb-9 max-[760px]:w-[min(100vw-22px,100%)]"
  >
    <RouterView />
  </main>
</template>
