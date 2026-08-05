export type JobState = "queued" | "running" | "done" | "failed" | "cancelled";
export type EncoderChoice = "vaapi" | "videotoolbox" | "software";
export type StreamSelection = "all" | "primary";
export type AudioMode = "copy" | "aac";
export type SubtitleMode = "copy" | "drop";

export interface Job {
  id: string;
  sourcePath: string;
  outputPath: string;
  qp: number;
  encoder: EncoderChoice;
  streamSelection: StreamSelection;
  audioMode: AudioMode;
  subtitleMode: SubtitleMode;
  state: JobState;
  pct: number;
  speed: string;
  elapsed: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  inputBytes: number | null;
  outputBytes: number | null;
  savedBytes: number | null;
  savedPercent: number | null;
}

export interface FsEntry {
  name: string;
  type: "file" | "directory";
  sizeBytes?: number;
  modifiedAt?: string;
  ext?: string;
}

export interface FsListing {
  path: string;
  entries: FsEntry[];
}

export interface HistoryEntry {
  timestamp: string;
  relativePath: string;
  status: "succeeded" | "failed";
  method: string;
  qp: number;
  inputBytes: number;
  outputBytes: number;
  savedBytes: number;
  savedPercent: number;
}

export interface StatsTotals {
  processed: number;
  succeeded: number;
  failed: number;
  inputBytes: number;
  outputBytes: number;
  savedBytes: number;
  avgSavedPercent: number;
}

export interface TranscodeDefaults {
  qp: number;
  encoder: EncoderChoice;
  streamSelection: StreamSelection;
  audioMode: AudioMode;
  subtitleMode: SubtitleMode;
}

export interface AppSettings {
  parallelJobs: number;
  defaultTranscode: TranscodeDefaults;
}

export interface AppSettingsLimits {
  min: number;
  max: number;
}
