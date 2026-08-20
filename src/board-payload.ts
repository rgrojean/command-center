import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fanoutNote, labelConcurrency, type FanoutRecord } from "./concurrency.js";
import { diffOpenApi, type DiffResult } from "./diff.js";
import { consumersOf, parseFleet, producerOf, type Fleet, type FleetRepo } from "./fleet.js";
import {
  humanImpactModelFor,
  researchModelFor,
  writeModelForGrade,
  writeModelsFor,
} from "./models.js";
import { FLEET_PATH } from "./paths.js";
import { needsHumanDecision, type MigrationSpec } from "./spec-schema.js";
import {
  inferPhase,
  listRunIds,
  promptPath,
  readManifest,
  repoDir,
  runDirFor,
  type GateDecisionRecord,
  type RunManifest,
  type RunPhase,
} from "./state.js";

export type DiffChip = {
  tone: "red" | "amber" | "slate";
  text: string;
};

export function chipsFromDiff(diff: {
  changes: DiffResult["changes"];
  unchanged: string[];
  summary: string;
}): DiffChip[] {
  const chips: DiffChip[] = [];
  if (diff.changes.length) {
    for (const c of diff.changes) {
      const line = diff.summary.split("\n").find((l) => l.includes(`\`${c.field}\``));
      if (c.kind === "removed") {
        const arrow = line?.match(/`[^`]+` → (.+?) \(/);
        if (arrow?.[1] && !line?.includes("no successor")) {
          chips.push({ tone: "amber", text: `~ ${c.field} → ${arrow[1].replaceAll("`", "")}` });
        } else {
          chips.push({ tone: "red", text: `− ${c.field}` });
        }
      } else {
        chips.push({ tone: "amber", text: `~ ${c.field}` });
      }
    }
  } else {
    for (const line of diff.summary.split("\n")) {
      const removed =
        line.match(/`([^`]+)` removed/) || line.match(/`([^`]+)` is removed/);
      const replaced = line.match(/`([^`]+)` → (.+?) \(/);
      const becomes = line.match(/`([^`]+)`[^(]* becomes (.+)\.?$/);
      if (removed?.[1]) chips.push({ tone: "red", text: `− ${removed[1]}` });
      else if (replaced?.[1] && replaced[2] && !line.includes("removed")) {
        chips.push({
          tone: "amber",
          text: `~ ${replaced[1]} → ${replaced[2].replaceAll("`", "")}`,
        });
      } else if (becomes?.[1] && becomes[2]) {
        chips.push({
          tone: "amber",
          text: `~ ${becomes[1]} → ${becomes[2].replaceAll("`", "").replace(/\.$/, "")}`,
        });
      }
    }
  }
  if (diff.unchanged.length) {
    const shown = diff.unchanged.slice(0, 4).join(" ");
    const more = diff.unchanged.length > 4 ? "…" : "";
    chips.push({ tone: "slate", text: `= ${shown}${more}` });
  } else {
    const u = diff.summary.match(/Unchanged: ([^.]+)/);
    if (u?.[1] && u[1] !== "(none)") {
      const fields = u[1]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith("URL") && !s.includes("/"));
      if (fields.length) {
        const shown = fields.slice(0, 4).join(" ");
        const more = fields.length > 4 ? "…" : "";
        chips.push({ tone: "slate", text: `= ${shown}${more}` });
      }
    }
  }
  return chips;
}

export type BoardEvent = {
  ts: string;
  repo: string;
  stage: string;
  type: string;
  message: string;
};

export type LanePayload = {
  slug: string;
  display_name: string;
  kind: FleetRepo["kind"];
  role: FleetRepo["role"];
  port?: number;
  db_port?: number;
  github_url: string;
  start_ref?: string;
  starting_sha?: string;
  verdict?: MigrationSpec["verdict"];
  execution_grade?: MigrationSpec["execution_grade"];
  grade_reasoning?: string;
  human_impact?: string;
  gandalf: "PASS" | "HELD" | "PENDING";
  research_model?: string;
  human_impact_model?: string;
  write_model?: string;
  gate?: RunManifest["repos"][string]["gate"];
  gate_note?: string;
  needs_decision: boolean;
  terminal?: RunManifest["repos"][string]["terminal"];
  stages: string[];
  pr?: { url: string; number?: number; stub?: boolean };
  escalation?: boolean;
  spec?: MigrationSpec;
  decision?: GateDecisionRecord;
  events: BoardEvent[];
  prompts: { research: boolean; human_impact: boolean; write: boolean };
};

export type ConcurrencyNote = {
  requested: string;
  effective: string;
  degraded: boolean;
  note: string;
  reason?: string;
};

export type BoardSnapshot = {
  runId: string;
  mode: "live" | "stub";
  phase: RunPhase;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  elapsed_s: number;
  producer: { slug: string; display_name: string };
  fleet_count: { repos: number; producers: number; consumers: number };
  diff?: Pick<DiffResult, "fields" | "changes" | "added" | "unchanged" | "summary" | "v2Path" | "v3Path">;
  chips: DiffChip[];
  models: {
    research: string;
    write: Record<string, string>;
  };
  concurrency?: {
    research?: ConcurrencyNote;
    write?: ConcurrencyNote;
  };
  timings?: { research_ms?: number; write_ms?: number };
  pending_decisions: string[];
  can_release: boolean;
  holding: boolean;
  controlling: boolean;
  lanes: LanePayload[];
};

function concurrencyNote(record: FanoutRecord | undefined): ConcurrencyNote | undefined {
  if (!record) return undefined;
  return {
    requested: labelConcurrency(record.requested),
    effective: labelConcurrency(record.effective),
    degraded: record.degraded,
    note: fanoutNote(record) ?? labelConcurrency(record.effective),
    reason: record.reason,
  };
}

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Live SDK assistant text arrives as token deltas; merge consecutive ones. */
function coalesceAssistantEvents(events: BoardEvent[]): BoardEvent[] {
  const out: BoardEvent[] = [];
  for (const event of events) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.repo === event.repo &&
      prev.stage === event.stage &&
      String(prev.type).toLowerCase() === "assistant" &&
      String(event.type).toLowerCase() === "assistant"
    ) {
      prev.message += event.message;
      continue;
    }
    out.push({ ...event });
  }
  return out;
}

function pickStageEvents(events: BoardEvent[]): BoardEvent[] {
  const marked = events.map((event, index) => ({
    event,
    index,
    assistant: String(event.type).toLowerCase() === "assistant",
  }));
  const keepOthers = new Set(
    marked.filter((row) => !row.assistant).slice(-40).map((row) => row.index),
  );
  return marked.filter((row) => row.assistant || keepOthers.has(row.index)).map((row) => row.event);
}

function loadEvents(runDir: string, slug: string): BoardEvent[] {
  const path = join(repoDir(runDir, slug), "events.ndjson");
  if (!existsSync(path)) return [];
  const all = coalesceAssistantEvents(
    readFileSync(path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as BoardEvent),
  );
  const stages = ["research", "human_impact", "write", "escalate_write"] as const;
  const picked: BoardEvent[] = [];
  for (const stage of stages) {
    picked.push(...pickStageEvents(all.filter((e) => e.stage === stage)));
  }
  const rest = all.filter((e) => !stages.includes(e.stage as (typeof stages)[number]));
  picked.push(...rest.slice(-20));
  return picked;
}

function prFromArtifacts(
  runDir: string,
  slug: string,
  prUrl?: string,
): LanePayload["pr"] {
  const fake = readJson<{ url: string; stub?: boolean }>(join(repoDir(runDir, slug), "fake-pr.json"));
  const real = readJson<{ url: string; number?: number; stub?: boolean }>(
    join(repoDir(runDir, slug), "pr.json"),
  );
  const rec = real ?? fake;
  const url = rec?.url ?? prUrl;
  if (!url) return undefined;
  const recorded = typeof real?.number === "number" ? real.number : undefined;
  const match = url.match(/\/pull\/(\d+)/);
  return {
    url,
    number: recorded ?? (match ? Number(match[1]) : undefined),
    stub: rec?.stub === true || url.includes("/pull/stub-"),
  };
}

function loadDiff(runDir: string, manifest: RunManifest): DiffResult | undefined {
  const stored = readJson<DiffResult>(join(runDir, "diff.json"));
  if (stored) return stored;
  const inputs = readJson<{ v2: string; v3: string }>(join(runDir, "inputs.json"));
  if (inputs?.v2 && inputs?.v3 && existsSync(inputs.v2) && existsSync(inputs.v3)) {
    try {
      return diffOpenApi(inputs.v2, inputs.v3);
    } catch {
      return undefined;
    }
  }
  if (manifest.diff_summary) {
    return {
      v2Path: "",
      v3Path: "",
      changes: [],
      fields: [],
      added: [],
      unchanged: [],
      summary: manifest.diff_summary,
    };
  }
  return undefined;
}

function loadRunFleet(runDir: string): Fleet {
  const copied = join(runDir, "fleet.json");
  if (existsSync(copied)) return parseFleet(JSON.parse(readFileSync(copied, "utf8")));
  return parseFleet(JSON.parse(readFileSync(FLEET_PATH, "utf8")));
}

export { liveEnabled } from "./cursor-auth.js";

export function assembleBoard(runId: string, controlling: boolean): BoardSnapshot {
  const runDir = runDirFor(runId);
  const manifest = readManifest(runDir);
  const fleet = loadRunFleet(runDir);
  const producer = producerOf(fleet);
  const consumers = consumersOf(fleet);
  const phase = inferPhase(manifest);
  const started = Date.parse(manifest.startedAt);
  const end = manifest.finishedAt ? Date.parse(manifest.finishedAt) : Date.now();
  const diff = loadDiff(runDir, manifest);
  const pending: string[] = [];

  const lanes: LanePayload[] = consumers.map((repo) => {
    const entry = manifest.repos[repo.slug];
    const spec = readJson<MigrationSpec>(join(repoDir(runDir, repo.slug), "spec.json"));
    const decision = readJson<GateDecisionRecord>(join(repoDir(runDir, repo.slug), "decision.json"));
    const needsDecision =
      !!spec &&
      needsHumanDecision(spec) &&
      !decision &&
      !entry?.gate &&
      (phase === "gate" || phase === "research");
    if (needsDecision && spec) pending.push(repo.slug);
    const grade = spec?.execution_grade ?? entry?.grade_override;
    const writeModel =
      entry?.model_used ??
      entry?.model_override ??
      (grade ? writeModelForGrade(grade, manifest.mode) : undefined);
    const gandalf: LanePayload["gandalf"] = !spec
      ? "PENDING"
      : spec.verdict === "blocked"
        ? "HELD"
        : "PASS";
    return {
      slug: repo.slug,
      display_name: repo.display_name,
      kind: repo.kind,
      role: repo.role,
      port: repo.port,
      db_port: repo.db_port,
      github_url: repo.github_url,
      start_ref: entry?.start_ref ?? repo.start_ref,
      starting_sha: entry?.starting_sha,
      verdict: spec?.verdict,
      execution_grade: grade,
      grade_reasoning: spec?.grade_reasoning,
      human_impact: spec?.downstream_impacts.overall_rating,
      gandalf,
      research_model: entry?.research_model ?? researchModelFor(manifest.mode),
      human_impact_model: entry?.human_impact_model ?? humanImpactModelFor(manifest.mode),
      write_model: writeModel,
      gate: entry?.gate ?? (decision?.decision === "skipped" ? "skipped" : decision?.decision),
      gate_note: entry?.gate_note ?? decision?.note,
      needs_decision: needsDecision,
      terminal: entry?.terminal,
      stages: entry?.stages ?? [],
      pr: prFromArtifacts(runDir, repo.slug, entry?.pr_url),
      escalation: existsSync(join(repoDir(runDir, repo.slug), "escalation.json")),
      spec,
      decision,
      events: loadEvents(runDir, repo.slug),
      prompts: {
        research: existsSync(promptPath(runDir, repo.slug, "research")),
        human_impact: existsSync(promptPath(runDir, repo.slug, "human_impact")),
        write: existsSync(promptPath(runDir, repo.slug, "write")),
      },
    };
  });

  const holding = phase === "gate" && controlling;
  return {
    runId: manifest.runId,
    mode: manifest.mode,
    phase,
    startedAt: manifest.startedAt,
    finishedAt: manifest.finishedAt,
    error: manifest.error,
    elapsed_s: Number.isFinite(started) ? Math.max(0, (end - started) / 1000) : 0,
    producer: { slug: producer.slug, display_name: producer.display_name },
    fleet_count: {
      repos: fleet.repos.length,
      producers: 1,
      consumers: consumers.length,
    },
    diff: diff
      ? {
          fields: diff.fields,
          changes: diff.changes,
          added: diff.added,
          unchanged: diff.unchanged,
          summary: diff.summary,
          v2Path: diff.v2Path,
          v3Path: diff.v3Path,
        }
      : undefined,
    chips: diff ? chipsFromDiff(diff) : [],
    models: {
      research: researchModelFor(manifest.mode),
      write: writeModelsFor(manifest.mode),
    },
    concurrency: {
      research: concurrencyNote(manifest.concurrency?.research),
      write: concurrencyNote(manifest.concurrency?.write),
    },
    timings: manifest.timings,
    pending_decisions: pending,
    can_release: holding && pending.length === 0,
    holding,
    controlling,
    lanes,
  };
}

export function latestRunId(): string | undefined {
  return listRunIds()[0];
}
