const statePill = document.querySelector("#state-pill");
const lastUpdated = document.querySelector("#last-updated");
const queueCount = document.querySelector("#queue-count");
const parallelJobs = document.querySelector("#parallel-jobs");
const qpValue = document.querySelector("#qp-value");
const watchMode = document.querySelector("#watch-mode");
const jobsSummary = document.querySelector("#jobs-summary");
const jobsList = document.querySelector("#jobs-list");
const statusMessage = document.querySelector("#status-message");
const statusMethod = document.querySelector("#status-method");
const batchTotal = document.querySelector("#batch-total");
const queueEta = document.querySelector("#queue-eta");
const batchProcessed = document.querySelector("#batch-processed");
const batchSucceeded = document.querySelector("#batch-succeeded");
const batchFailed = document.querySelector("#batch-failed");
const rulesSummary = document.querySelector("#rules-summary");
const rulesList = document.querySelector("#rules-list");
const addRuleButton = document.querySelector("#add-rule-button");
const saveRulesButton = document.querySelector("#save-rules-button");
const rulesFeedback = document.querySelector("#rules-feedback");
const rescanButton = document.querySelector("#rescan-button");
const actionFeedback = document.querySelector("#action-feedback");

let currentRules = [];

function stateLabel(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function setFeedback(node, message, kind = "") {
  node.textContent = message;
  node.className = "action-feedback";
  if (kind) {
    node.classList.add(kind);
  } else {
    node.classList.add("muted");
  }
}

function renderRules() {
  rulesSummary.textContent = `${currentRules.length} active rule${currentRules.length === 1 ? "" : "s"}`;

  if (!currentRules.length) {
    rulesList.innerHTML =
      '<div class="empty-state">No folder-specific QP rules yet.</div>';
    return;
  }

  rulesList.innerHTML = currentRules
    .map(
      (rule, index) => `
      <div class="rule-row" data-index="${index}">
        <input class="rule-input" type="text" placeholder="Anime/Season 1" value="${rule.pathPrefix || ""}" />
        <input class="rule-number" type="number" min="0" max="51" step="1" value="${rule.qp ?? 22}" />
        <button class="rule-remove" type="button">Remove</button>
      </div>
    `,
    )
    .join("");
}

function syncRulesFromDom() {
  currentRules = Array.from(document.querySelectorAll(".rule-row"))
    .map((row) => {
      const pathPrefix = row.querySelector(".rule-input").value.trim();
      const qp = Number.parseInt(row.querySelector(".rule-number").value, 10);
      return { pathPrefix, qp };
    })
    .filter((rule) => rule.pathPrefix && Number.isInteger(rule.qp));
}

async function loadRules() {
  const response = await fetch("/api/rules", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = await response.json();
  currentRules = Array.isArray(payload.rules) ? payload.rules : [];
  renderRules();
}

async function saveRules() {
  syncRulesFromDom();
  saveRulesButton.disabled = true;
  setFeedback(rulesFeedback, "Saving rules…");

  try {
    const response = await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rules: currentRules }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    currentRules = Array.isArray(payload.rules) ? payload.rules : [];
    renderRules();
    setFeedback(rulesFeedback, "Rules saved.", "success");
  } catch (error) {
    setFeedback(rulesFeedback, "Failed to save rules.", "error");
  } finally {
    saveRulesButton.disabled = false;
  }
}

async function triggerRescan() {
  rescanButton.disabled = true;
  setFeedback(actionFeedback, "Triggering rescan…");

  try {
    const response = await fetch("/api/actions/rescan", { method: "POST" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    setFeedback(
      actionFeedback,
      "Rescan trigger written. The watcher should wake immediately.",
      "success",
    );
  } catch (error) {
    setFeedback(actionFeedback, "Failed to trigger rescan.", "error");
  } finally {
    rescanButton.disabled = false;
  }
}

function renderJobs(jobs) {
  const activeJobs = jobs.filter((job) => job.state === "run");
  jobsSummary.textContent = activeJobs.length
    ? `${activeJobs.length} active worker${activeJobs.length === 1 ? "" : "s"}`
    : "No active workers";

  if (!activeJobs.length) {
    jobsList.className = "jobs-list empty-state";
    jobsList.textContent = "No active jobs right now.";
    return;
  }

  jobsList.className = "jobs-list";
  jobsList.innerHTML = activeJobs
    .map((job) => {
      const pct = Number.parseFloat(job.pct || "0") || 0;
      const width = Math.max(0, Math.min(100, pct));
      return `
      <article class="job-card">
        <div class="job-head">
          <div>
            <p class="job-index">Job #${String(job.index).padStart(2, "0")}</p>
            <h3 title="${job.name}">${job.name || "Unnamed file"}</h3>
          </div>
          <span class="job-speed">${job.speed}</span>
        </div>
        <div class="job-bar-track">
          <div class="job-bar-fill" style="width:${width}%"></div>
        </div>
        <div class="job-meta">
          <span>${pct.toFixed(2)}%</span>
          <span>${job.elapsed}s elapsed</span>
        </div>
      </article>
    `;
    })
    .join("");
}

function applyStatus(data) {
  statePill.textContent = stateLabel(data.state || "unknown");
  statePill.dataset.state = data.state || "unknown";
  lastUpdated.textContent = `Updated ${new Date(data.servedAt || data.updatedAt).toLocaleTimeString()}`;
  queueCount.textContent = String(data.queueCount ?? 0);
  parallelJobs.textContent = String(data.parallelJobs ?? 0);
  qpValue.textContent = String(data.qp ?? 0);
  watchMode.textContent = Number(data.watchMode) === 1 ? "On" : "Off";
  statusMessage.textContent = data.message || "No message";
  statusMethod.textContent = data.method || "intel_h265";
  batchTotal.textContent = String(data.batchTotal ?? 0);
  queueEta.textContent = data.queueEtaLabel || "Estimating…";
  batchProcessed.textContent = String(data.batchProcessed ?? 0);
  batchSucceeded.textContent = String(data.batchSucceeded ?? 0);
  batchFailed.textContent = String(data.batchFailed ?? 0);
  rulesSummary.textContent = `${data.rulesCount ?? currentRules.length} active rule${(data.rulesCount ?? currentRules.length) === 1 ? "" : "s"}`;
  renderJobs(data.jobs || []);
}

async function refresh() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    applyStatus(data);
  } catch (error) {
    statePill.textContent = "Offline";
    statePill.dataset.state = "offline";
    lastUpdated.textContent = "Dashboard cannot reach runtime state.";
    jobsSummary.textContent = "Waiting for server";
    jobsList.className = "jobs-list empty-state";
    jobsList.textContent = "The admin endpoint is currently unavailable.";
  }
}

rulesList.addEventListener("click", (event) => {
  if (
    !(event.target instanceof HTMLElement) ||
    !event.target.classList.contains("rule-remove")
  ) {
    return;
  }

  const row = event.target.closest(".rule-row");
  if (!row) {
    return;
  }

  row.remove();
  syncRulesFromDom();
  renderRules();
});

addRuleButton.addEventListener("click", () => {
  currentRules.push({ pathPrefix: "", qp: 22 });
  renderRules();
});

saveRulesButton.addEventListener("click", () => {
  saveRules();
});

rescanButton.addEventListener("click", () => {
  triggerRescan();
});

refresh();
setInterval(refresh, 2000);
loadRules().catch(() => {
  setFeedback(rulesFeedback, "Failed to load rules.", "error");
});
