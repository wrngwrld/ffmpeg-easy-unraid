#!/usr/bin/env python3
import json
import os
import posixpath
import re
from statistics import mean
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path("/opt/ffmpeg-easy/web")
STATE_DIR = Path("/tmp/ffmpeg-easy-admin")
STATUS_FILE = STATE_DIR / "status.json"
PROGRESS_DIR = STATE_DIR / "progress"
IMPORT_DIR = Path("/import")
FINISHED_DIR = IMPORT_DIR / "finished"
CONFIG_DIR = Path("/export/.ffmpeg-easy-admin")
RULES_FILE = CONFIG_DIR / "rules.json"
STATS_FILE = CONFIG_DIR / "stats.json"
RESCAN_TRIGGER = IMPORT_DIR / ".ffmpeg-easy-rescan.trigger"
MEDIA_EXTENSIONS = {".mkv", ".mp4", ".ts", ".m2ts", ".avi", ".mov", ".wmv"}


def get_admin_port() -> int:
    raw_value = os.environ.get("ADMIN_PORT", "8080").strip()
    if not raw_value:
        return 8080

    try:
        port = int(raw_value)
    except ValueError:
        return 8080

    if port < 1 or port > 65535:
        return 8080

    return port


PORT = get_admin_port()


def natural_sort_key(value: str):
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", value)]


def default_rules_payload() -> dict:
    return {"rules": []}


def read_rules() -> dict:
    if RULES_FILE.exists():
        try:
            payload = json.loads(RULES_FILE.read_text(encoding="utf-8"))
            if isinstance(payload, dict) and isinstance(payload.get("rules", []), list):
                return payload
        except (json.JSONDecodeError, OSError):
            pass

    return default_rules_payload()


def sanitize_rules(payload: dict) -> dict:
    raw_rules = payload.get("rules", []) if isinstance(payload, dict) else []
    sanitized = []

    for rule in raw_rules:
        if not isinstance(rule, dict):
            continue

        path_prefix = str(rule.get("pathPrefix", "")).strip().strip("/")
        qp = rule.get("qp")
        if not path_prefix:
            continue

        try:
            qp_value = int(qp)
        except (TypeError, ValueError):
            continue

        if qp_value < 0 or qp_value > 51:
            continue

        sanitized.append({"pathPrefix": path_prefix, "qp": qp_value})

    return {"rules": sanitized}


def write_rules(payload: dict) -> dict:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    sanitized = sanitize_rules(payload)
    RULES_FILE.write_text(json.dumps(sanitized, indent=2), encoding="utf-8")
    return sanitized


def write_rescan_trigger() -> None:
    if not IMPORT_DIR.exists():
        raise FileNotFoundError("Import directory does not exist")

    RESCAN_TRIGGER.write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")


def count_queue_files() -> int:
    if not IMPORT_DIR.exists():
        return 0

    total = 0
    for current_root, dirs, files in os.walk(IMPORT_DIR):
        current_path = Path(current_root)
        if current_path == FINISHED_DIR:
            dirs[:] = []
            continue

        dirs[:] = [entry for entry in dirs if (current_path / entry) != FINISHED_DIR]
        for name in files:
            if Path(name).suffix.lower() in MEDIA_EXTENSIONS:
                total += 1
    return total


def format_duration(seconds: float | None) -> str:
    if seconds is None:
        return "Estimating…"

    seconds = max(0, int(round(seconds)))
    hours, remainder = divmod(seconds, 3600)
    minutes, secs = divmod(remainder, 60)

    if hours > 0:
        return f"{hours}h {minutes:02d}m"
    if minutes > 0:
        return f"{minutes}m {secs:02d}s"
    return f"{secs}s"


def estimate_queue_remaining(queue_count: int, jobs: list[dict], parallel_jobs: int) -> float | None:
    active_jobs = [job for job in jobs if job.get("state") == "run"]
    if queue_count <= 0 and not active_jobs:
        return 0.0

    slot_times: list[float] = []
    total_durations: list[float] = []
    unresolved_jobs = 0

    for job in active_jobs:
        try:
            pct = float(job.get("pct", "0"))
            elapsed = int(float(job.get("elapsed", "0")))
        except (TypeError, ValueError):
            unresolved_jobs += 1
            continue

        if pct > 0 and elapsed >= 0:
            total_duration = elapsed / (pct / 100.0)
            remaining = max(total_duration - elapsed, 0.0)
            total_durations.append(total_duration)
            slot_times.append(remaining)
        else:
            unresolved_jobs += 1

    avg_total_duration = mean(total_durations) if total_durations else None

    if unresolved_jobs:
        if avg_total_duration is None:
            return None
        slot_times.extend([avg_total_duration] * unresolved_jobs)

    worker_slots = max(parallel_jobs, len(slot_times), 1)
    while len(slot_times) < worker_slots:
        slot_times.append(0.0)

    waiting_jobs = max(0, queue_count - len(active_jobs))
    if waiting_jobs > 0:
        if avg_total_duration is None:
            return None
        for _ in range(waiting_jobs):
            next_slot = min(range(len(slot_times)), key=slot_times.__getitem__)
            slot_times[next_slot] += avg_total_duration

    return max(slot_times) if slot_times else 0.0


def read_status() -> dict:
    if STATUS_FILE.exists():
        try:
            return json.loads(STATUS_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass

    return {
        "state": "unknown",
        "message": "Waiting for runtime state",
        "method": "intel_h265",
        "qp": 0,
        "watchMode": 0,
        "parallelJobs": 1,
        "livePreview": 0,
        "batchTotal": "0",
        "batchProcessed": 0,
        "batchSucceeded": 0,
        "batchFailed": 0,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


def default_stats_payload() -> dict:
    return {
        "version": 1,
        "updatedAt": "",
        "totals": {
            "processed": 0,
            "succeeded": 0,
            "failed": 0,
            "inputBytes": 0,
            "outputBytes": 0,
            "savedBytes": 0,
            "avgSavedPercent": 0.0,
        },
        "recentFiles": [],
    }


def read_stats() -> dict:
    if STATS_FILE.exists():
        try:
            payload = json.loads(STATS_FILE.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                default_payload = default_stats_payload()
                default_payload.update(payload)

                totals = default_payload.get("totals", {})
                if not isinstance(totals, dict):
                    totals = {}

                merged_totals = default_stats_payload()["totals"]
                merged_totals.update(totals)
                default_payload["totals"] = merged_totals

                recent_files = default_payload.get("recentFiles", [])
                default_payload["recentFiles"] = recent_files if isinstance(recent_files, list) else []
                return default_payload
        except (json.JSONDecodeError, OSError):
            pass

    return default_stats_payload()


def read_jobs() -> list[dict]:
    if not PROGRESS_DIR.exists():
        return []

    jobs = []
    for path in sorted(PROGRESS_DIR.glob("*.status"), key=lambda item: natural_sort_key(item.name)):
        try:
            raw = path.read_text(encoding="utf-8").strip()
        except OSError:
            continue

        if not raw:
            continue

        fields = {}
        for part in raw.split("|"):
            if "=" not in part:
                continue
            key, value = part.split("=", 1)
            fields[key] = value

        if not fields:
            continue

        jobs.append(
            {
                "state": fields.get("state", "unknown"),
                "index": fields.get("index", "0"),
                "name": fields.get("name", ""),
                "pct": fields.get("pct", "0.00"),
                "speed": fields.get("speed", "n/a"),
                "elapsed": fields.get("elapsed", "0"),
                "out": fields.get("out", "0"),
            }
        )
    return jobs


class AdminHandler(SimpleHTTPRequestHandler):
    def read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(length) if length > 0 else b"{}"
        if not raw_body:
            return {}
        return json.loads(raw_body.decode("utf-8"))

    def send_json(self, payload: dict, status: int = HTTPStatus.OK):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def translate_path(self, path: str) -> str:
        path = path.split("?", 1)[0].split("#", 1)[0]
        normalized = posixpath.normpath(path)
        parts = [part for part in normalized.split("/") if part and part not in {".", ".."}]
        resolved = ROOT
        for part in parts:
            resolved /= part
        return str(resolved)

    def do_GET(self):
        if self.path.startswith("/api/status"):
            payload = read_status()
            stats_payload = read_stats()
            queue_count = count_queue_files()
            jobs = read_jobs()
            parallel_jobs = int(payload.get("parallelJobs", 1) or 1)
            queue_eta_seconds = estimate_queue_remaining(queue_count, jobs, parallel_jobs)

            payload["queueCount"] = queue_count
            payload["jobs"] = jobs
            payload["queueEtaSeconds"] = None if queue_eta_seconds is None else int(round(queue_eta_seconds))
            payload["queueEtaLabel"] = format_duration(queue_eta_seconds)
            payload["rulesCount"] = len(read_rules().get("rules", []))
            payload["stats"] = stats_payload
            payload["servedAt"] = datetime.now(timezone.utc).isoformat()
            self.send_json(payload)
            return

        if self.path.startswith("/api/rules"):
            self.send_json(read_rules())
            return

        if self.path in {"/", ""}:
            self.path = "/index.html"

        return super().do_GET()

    def do_POST(self):
        if self.path == "/api/rules":
            try:
                payload = self.read_json_body()
            except json.JSONDecodeError:
                self.send_json({"error": "Invalid JSON payload"}, HTTPStatus.BAD_REQUEST)
                return

            saved = write_rules(payload)
            self.send_json(saved)
            return

        if self.path == "/api/actions/rescan":
            try:
                write_rescan_trigger()
            except OSError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)
                return

            self.send_json({"ok": True, "message": "Rescan trigger written"})
            return

        self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def log_message(self, fmt: str, *args):
        return


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    if not RULES_FILE.exists():
        write_rules(default_rules_payload())
    with ThreadingHTTPServer(("0.0.0.0", PORT), AdminHandler) as httpd:
        httpd.serve_forever()


if __name__ == "__main__":
    main()
