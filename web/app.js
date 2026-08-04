const { createApp } = Vue;

createApp({
  data() {
    return {
      currentView: "overview",
      status: {
        state: "unknown",
        message: "Waiting for runtime state",
        method: "intel_h265",
        qp: 0,
        watchMode: 0,
        parallelJobs: 1,
        batchTotal: "0",
        batchProcessed: 0,
        batchSucceeded: 0,
        batchFailed: 0,
        queueCount: 0,
        queueEtaLabel: "Estimating...",
        jobs: [],
        stats: { totals: {}, recentFiles: [] },
        servedAt: "",
        updatedAt: "",
      },
      queueItems: [],
      historyItems: [],
      historyTotal: 0,
      historyTotals: {
        processed: 0,
        succeeded: 0,
        failed: 0,
        savedBytes: 0,
      },
      rules: [],
      actionFeedbackText:
        "Wake the watcher immediately when new files were copied into /import.",
      actionFeedbackKind: "muted",
      rulesFeedbackText: "Example prefix: Anime/Season 1 or Movies/4K",
      rulesFeedbackKind: "muted",
      rescanBusy: false,
      saveRulesBusy: false,
      refreshTimer: null,
    };
  },
  computed: {
    activeJobs() {
      const jobs = Array.isArray(this.status.jobs) ? this.status.jobs : [];
      return jobs.filter((job) => job.state === "run");
    },
    jobsSummary() {
      const count = this.activeJobs.length;
      return count
        ? `${count} active worker${count === 1 ? "" : "s"}`
        : "No active workers";
    },
    statsTotals() {
      const stats = this.status?.stats?.totals;
      if (!stats || typeof stats !== "object") {
        return {
          inputBytes: 0,
          outputBytes: 0,
          savedBytes: 0,
          avgSavedPercent: 0,
        };
      }
      return stats;
    },
    recentFiles() {
      const files = this.status?.stats?.recentFiles;
      return Array.isArray(files) ? files : [];
    },
    lastUpdatedText() {
      const source = this.status.servedAt || this.status.updatedAt;
      if (!source) {
        return "Waiting for runtime state...";
      }
      return `Updated ${new Date(source).toLocaleTimeString()}`;
    },
  },
  methods: {
    stateLabel(value) {
      if (!value || typeof value !== "string") {
        return "Unknown";
      }
      return value.charAt(0).toUpperCase() + value.slice(1);
    },
    feedbackClass(kind) {
      return kind ? kind : "muted";
    },
    formatBytes(value) {
      const bytes = Number(value) || 0;
      const abs = Math.abs(bytes);
      if (abs >= 1024 ** 3) {
        return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
      }
      if (abs >= 1024 ** 2) {
        return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
      }
      if (abs >= 1024) {
        return `${(bytes / 1024).toFixed(2)} KB`;
      }
      return `${bytes} B`;
    },
    formatPercent(value) {
      const num = Number(value);
      if (Number.isNaN(num)) {
        return "0.00%";
      }
      return `${num.toFixed(2)}%`;
    },
    formatDateTime(value) {
      if (!value) {
        return "unknown";
      }
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        return "unknown";
      }
      return parsed.toLocaleString();
    },
    jobPct(job) {
      const pct = Number.parseFloat(job?.pct || "0") || 0;
      return Math.max(0, Math.min(100, pct));
    },
    switchView(view) {
      const allowed = new Set(["overview", "queue", "history", "system"]);
      const nextView = allowed.has(view) ? view : "overview";
      this.currentView = nextView;
      if (window.location.hash !== `#${nextView}`) {
        window.location.hash = `#${nextView}`;
      }
    },
    syncViewFromHash() {
      const hash = window.location.hash.replace("#", "").trim();
      const allowed = new Set(["overview", "queue", "history", "system"]);
      this.currentView = allowed.has(hash) ? hash : "overview";
    },
    async fetchJson(url) {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    },
    setOfflineState() {
      this.status = {
        ...this.status,
        state: "offline",
        message: "Dashboard cannot reach runtime state.",
      };
    },
    addRule() {
      this.rules.push({ pathPrefix: "", qp: 22 });
    },
    removeRule(index) {
      this.rules.splice(index, 1);
    },
    async loadRules() {
      try {
        const payload = await this.fetchJson("/api/rules");
        this.rules = Array.isArray(payload.rules) ? payload.rules : [];
      } catch {
        this.rulesFeedbackText = "Failed to load rules.";
        this.rulesFeedbackKind = "error";
      }
    },
    normalizedRules() {
      return this.rules
        .map((rule) => {
          const pathPrefix = String(rule.pathPrefix || "").trim();
          const qp = Number.parseInt(rule.qp, 10);
          return { pathPrefix, qp };
        })
        .filter((rule) => rule.pathPrefix && Number.isInteger(rule.qp));
    },
    async saveRules() {
      this.saveRulesBusy = true;
      this.rulesFeedbackText = "Saving rules...";
      this.rulesFeedbackKind = "muted";

      try {
        const payload = await fetch("/api/rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rules: this.normalizedRules() }),
        }).then(async (response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          return response.json();
        });

        this.rules = Array.isArray(payload.rules) ? payload.rules : [];
        this.rulesFeedbackText = "Rules saved.";
        this.rulesFeedbackKind = "success";
      } catch {
        this.rulesFeedbackText = "Failed to save rules.";
        this.rulesFeedbackKind = "error";
      } finally {
        this.saveRulesBusy = false;
      }
    },
    async triggerRescan() {
      this.rescanBusy = true;
      this.actionFeedbackText = "Triggering rescan...";
      this.actionFeedbackKind = "muted";

      try {
        await fetch("/api/actions/rescan", { method: "POST" }).then(
          (response) => {
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
          },
        );

        this.actionFeedbackText =
          "Rescan trigger written. The watcher should wake immediately.";
        this.actionFeedbackKind = "success";
      } catch {
        this.actionFeedbackText = "Failed to trigger rescan.";
        this.actionFeedbackKind = "error";
      } finally {
        this.rescanBusy = false;
      }
    },
    async refreshStatus() {
      const payload = await this.fetchJson("/api/status");
      this.status = {
        ...this.status,
        ...payload,
      };
    },
    async refreshQueue() {
      const payload = await this.fetchJson("/api/queue");
      this.queueItems = Array.isArray(payload.items) ? payload.items : [];
    },
    async refreshHistory() {
      const payload = await this.fetchJson("/api/history?limit=500");
      this.historyItems = Array.isArray(payload.items) ? payload.items : [];
      this.historyTotal =
        Number(payload.total ?? this.historyItems.length) || 0;
      this.historyTotals = {
        processed: Number(payload.totals?.processed || 0),
        succeeded: Number(payload.totals?.succeeded || 0),
        failed: Number(payload.totals?.failed || 0),
        savedBytes: Number(payload.totals?.savedBytes || 0),
      };
    },
    async refreshAll() {
      const results = await Promise.allSettled([
        this.refreshStatus(),
        this.refreshQueue(),
        this.refreshHistory(),
      ]);

      if (results[0]?.status === "rejected") {
        this.setOfflineState();
      }
    },
  },
  mounted() {
    this.syncViewFromHash();
    window.addEventListener("hashchange", this.syncViewFromHash);

    this.refreshAll();
    this.loadRules();

    this.refreshTimer = window.setInterval(() => {
      this.refreshAll();
    }, 3000);
  },
  beforeUnmount() {
    window.removeEventListener("hashchange", this.syncViewFromHash);
    if (this.refreshTimer) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  },
}).mount("#app");
