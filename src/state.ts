import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FanoutRecord } from "./concurrency.js";
import { STATE_DIR } from "./paths.js";
import type { ExecutionGrade } from "./spec-schema.js";
import type { PipelineStage, TerminalState } from "./terminal-states.js";

export type RunEvent = {
  ts: string;
  repo: string;
  stage: PipelineStage | "run";
  type: string;
  message: string;
  data?: unknown;
};

export type RunPhase = "research" | "gate" | "write" | "done" | "failed";

export type GateDecisionRecord = {
  decision: "approved" | "rejected" | "skipped";
  note?: string;
  grade_override?: ExecutionGrade;
  model_override?: string;
  at: string;
};

export type RepoManifest = {
  slug: string;
  display_name: string;
  start_ref?: string;
  starting_sha?: string;
  stages: PipelineStage[];
  gate?: "approved" | "rejected" | "skipped";
  gate_note?: string;
  grade_override?: ExecutionGrade;
  model_override?: string;
  terminal?: TerminalState;
  model_used?: string;
  research_model?: string;
  human_impact_model?: string;
  escalated?: boolean;
  pr_url?: string;
};

export type RunTimings = {
  research_ms?: number;
  write_ms?: number;
};

export type RunConcurrency = {
  research: FanoutRecord;
  write: FanoutRecord;
};

export type RunManifest = {
  runId: string;
  mode: "live" | "stub";
  startedAt: string;
  finishedAt?: string;
  phase?: RunPhase;
  error?: string;
  diff_summary?: string;
  timings?: RunTimings;
  concurrency?: RunConcurrency;
  repos: Record<string, RepoManifest>;
};

export function createRun(mode: "live" | "stub"): {
  runId: string;
  dir: string;
  manifest: RunManifest;
} {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(STATE_DIR, runId);
  mkdirSync(dir, { recursive: true });
  const manifest: RunManifest = {
    runId,
    mode,
    startedAt: new Date().toISOString(),
    phase: "research",
    repos: {},
  };
  writeManifest(dir, manifest);
  return { runId, dir, manifest };
}

export function writeManifest(runDir: string, manifest: RunManifest): void {
  writeFileSync(
    join(runDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}

export function repoDir(runDir: string, slug: string): string {
  const dir = join(runDir, slug);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function appendEvent(runDir: string, event: RunEvent): void {
  const line = JSON.stringify(event) + "\n";
  appendFileSync(join(repoDir(runDir, event.repo), "events.ndjson"), line);
}

/** Run-level (not per-repo) event — concurrency degradation, fan-out launch. */
export function appendRunEvent(runDir: string, event: Omit<RunEvent, "repo">): void {
  const line = JSON.stringify({ repo: "*", ...event }) + "\n";
  appendFileSync(join(runDir, "events.ndjson"), line);
}

export function writeJson(runDir: string, slug: string, name: string, value: unknown): string {
  const path = join(repoDir(runDir, slug), name);
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
  return path;
}

export const PROMPT_FILES = {
  research: "research.prompt.md",
  human_impact: "human-impact.prompt.md",
  write: "write.prompt.md",
} as const;
export type PromptStage = keyof typeof PROMPT_FILES;

export function writePrompt(runDir: string, slug: string, stage: PromptStage, text: string): string {
  const path = join(repoDir(runDir, slug), PROMPT_FILES[stage]);
  writeFileSync(path, text);
  return path;
}

export function promptPath(runDir: string, slug: string, stage: PromptStage): string {
  return join(runDir, slug, PROMPT_FILES[stage]);
}

export function writeRunJson(runDir: string, name: string, value: unknown): string {
  const path = join(runDir, name);
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
  return path;
}

export function runDirFor(runId: string): string {
  return join(STATE_DIR, runId);
}

export function readManifest(runDir: string): RunManifest {
  const path = join(runDir, "manifest.json");
  if (!existsSync(path)) {
    throw new Error(`run not found`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as RunManifest;
}

export function listRunIds(): string[] {
  if (!existsSync(STATE_DIR)) return [];
  return readdirSync(STATE_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && d.name !== "uploads")
    .map((d) => d.name)
    .sort()
    .reverse();
}

export function inferPhase(manifest: RunManifest): RunPhase {
  if (manifest.phase) return manifest.phase;
  if (manifest.finishedAt) return "done";
  const repos = Object.values(manifest.repos);
  if (repos.length === 0) return "research";
  if (repos.every((r) => r.terminal)) return "done";
  if (repos.some((r) => r.stages.includes("write") || r.stages.includes("pr") || r.stages.includes("fake_pr"))) {
    return "write";
  }
  if (repos.some((r) => r.stages.includes("validate") || r.stages.includes("gate"))) return "gate";
  return "research";
}

export function touchStage(manifest: RunManifest, slug: string, stage: PipelineStage): void {
  const repo = manifest.repos[slug];
  if (!repo) return;
  if (!repo.stages.includes(stage)) repo.stages.push(stage);
}

export function nowIso(): string {
  return new Date().toISOString();
}
