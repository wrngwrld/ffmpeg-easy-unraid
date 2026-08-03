#!/usr/bin/env python3
import json
import os
import posixpath
import re
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
            payload["queueCount"] = count_queue_files()
            payload["jobs"] = read_jobs()
            payload["servedAt"] = datetime.now(timezone.utc).isoformat()

            body = json.dumps(payload).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if self.path in {"/", ""}:
            self.path = "/index.html"

        return super().do_GET()

    def log_message(self, fmt: str, *args):
        return


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    with ThreadingHTTPServer(("0.0.0.0", PORT), AdminHandler) as httpd:
        httpd.serve_forever()


if __name__ == "__main__":
    main()
