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
const batchProcessed = document.querySelector("#batch-processed");
const batchSucceeded = document.querySelector("#batch-succeeded");
const batchFailed = document.querySelector("#batch-failed");

function stateLabel(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
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
  batchProcessed.textContent = String(data.batchProcessed ?? 0);
  batchSucceeded.textContent = String(data.batchSucceeded ?? 0);
  batchFailed.textContent = String(data.batchFailed ?? 0);
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

refresh();
setInterval(refresh, 2000);
