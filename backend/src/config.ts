import path from "node:path";

export const MEDIA_DIR = process.env.MEDIA_DIR ?? "/media";
export const EXPORT_DIR = process.env.EXPORT_DIR ?? "/export";
export const CONFIG_DIR = process.env.CONFIG_DIR ?? "/config";
export const PORT = Math.max(1, parseInt(process.env.ADMIN_PORT ?? "8080", 10));
export const PARALLEL_JOBS = Math.max(
  1,
  parseInt(process.env.PARALLEL_JOBS ?? "1", 10),
);

// Frontend dist path — overridden in Docker by STATIC_ROOT env
export const STATIC_ROOT =
  process.env.STATIC_ROOT ??
  path.resolve(import.meta.dirname, "../../frontend/dist");

export const STATS_FILE = path.join(CONFIG_DIR, "stats.json");
export const SETTINGS_FILE = path.join(CONFIG_DIR, "settings.json");

export const MEDIA_EXTENSIONS = new Set([
  ".mkv",
  ".mp4",
  ".ts",
  ".m2ts",
  ".avi",
  ".mov",
  ".wmv",
]);
