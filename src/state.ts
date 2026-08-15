import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STATE_DIR } from "./paths.ts";
import type { PipelineStage, TerminalState } from "./terminal-states.ts";

export type RunEvent = {
  ts: string;
  repo: string;
  stage: PipelineStage | "run";
  type: string;
  message: string;
  data?: unknown;
};

export type RepoManifest = {
  slug: string;
  display_name: string;
  stages: PipelineStage[];
  gate?: "approved" | "rejected" | "skipped";
  terminal?: TerminalState;
  model_used?: string;
  escalated?: boolean;
};

export type RunManifest = {
  runId: string;
  mode: "live" | "stub";
  startedAt: string;
  finishedAt?: string;
  diff_summary?: string;
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

export function writeJson(runDir: string, slug: string, name: string, value: unknown): string {
  const path = join(repoDir(runDir, slug), name);
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
  return path;
}

export function touchStage(manifest: RunManifest, slug: string, stage: PipelineStage): void {
  const repo = manifest.repos[slug];
  if (!repo) return;
  if (!repo.stages.includes(stage)) repo.stages.push(stage);
}

export function nowIso(): string {
  return new Date().toISOString();
}
