import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ZodType } from "zod";
import { runReadOnlyAgent, runWriteAgent } from "./agents.js";
import {
  ensureBilboClone,
  ensureClone,
  ensureProducerClone,
  inspectResearchWorkspace,
  prepareWriteWorkspace,
  workspaceFor,
} from "./clone.js";
import { diffOpenApi, resolveV2Path } from "./diff.js";
import {
  applyDegrade,
  initialFanout,
  isCapacityError,
  labelConcurrency,
  mapFanout,
  type Concurrency,
} from "./concurrency.js";
import {
  consumersOf,
  fleetResearchConcurrency,
  fleetWriteConcurrency,
  loadFleet,
  producerOf,
  researchConsumersOf,
  businessContextProse,
  type Fleet,
  type FleetRepo,
} from "./fleet.js";
import { buildEscalation, buildFakePr } from "./fake-pr.js";
import { runGate } from "./gate.js";
import { isPipelineKilled, type HttpDecision, type HttpHold } from "./hold.js";
import { mergeResearchAndHumanImpact } from "./merge.js";
import {
  humanImpactModelFor,
  nextModelTier,
  researchModelFor,
  writeModelForGrade,
} from "./models.js";
import { notify } from "./notifier.js";
import { V2_SPEC_PATH, V3_SPEC_COPY, V3_SPEC_PATH, STATE_DIR, FLEET_PATH } from "./paths.js";
import { applyPolicies } from "./policies.js";
import { openPullRequest } from "./pr.js";
import {
  renderHumanImpactPrompt,
  renderResearchPrompt,
  renderWritePrompt,
} from "./prompts.js";
import type { AgentMode, RunAgentResult } from "./run-agent.js";
import { HumanImpactSchema } from "./human-impact-schema.js";
import {
  migrationSpecSchemaFor,
  needsHumanDecision,
  researchSpecSchemaFor,
  type MigrationSpec,
  type WorkspaceHygiene,
} from "./spec-schema.js";
import {
  appendEvent,
  appendRunEvent,
  createRun,
  nowIso,
  repoDir,
  touchStage,
  writeJson,
  writeManifest,
  writePrompt,
  writeRunJson,
  type RunManifest,
} from "./state.js";
import type { PipelineStage, TerminalState } from "./terminal-states.js";
import { WriteSummarySchema, writeRunFailed, type WriteSummary } from "./write-summary-schema.js";
import { openRealPrs, useCloudAgents } from "./runtime.js";

const INNER_RETRY_BUDGET = 3;

function assertNotKilled(hold?: HttpHold): void {
  if (hold?.aborted) throw hold.aborted;
}

function agentCtl(hold?: HttpHold) {
  return {
    signal: hold?.signal,
    registerCancel: hold?.registerCancel,
  };
}

export type PipelineOptions = {
  mode: AgentMode;
  autoApprove: boolean;
  /** M1 live stops after the gate. M2 live and stub run write fan-out. */
  until: "gate" | "write";
  /** If set, only these slugs are researched. Others require `fromRun`. */
  repos?: string[];
  /** Reuse specs from a prior run (portal-only re-research, then M2 write). */
  fromRun?: string;
  /** ENGAGE inputs. Defaults: bundled OpenAPI pair + repo fleet.json. */
  v2Path?: string;
  v3Path?: string;
  fleetPath?: string;
  /** Injected into LEGOLAS and GIMLI prompts. */
  businessContext?: string;
  /** HTTP doorway: same pipeline, hold at gate until decisions + release. */
  httpHold?: HttpHold;
  /** Orchestrator creates the run dir first so POST /runs can return runId. */
  existing?: { runId: string; dir: string; manifest: RunManifest };
  /** Across-repo research pairs. Default from fleet.json, else full. */
  researchConcurrency?: Concurrency;
  /** Across approved-repo writes. Default from fleet.json, else full. */
  writeConcurrency?: Concurrency;
};

type DiffSchemas = {
  research: ReturnType<typeof researchSpecSchemaFor>;
  migration: ReturnType<typeof migrationSpecSchemaFor>;
  fields: string[];
};

function terminalFor(spec: MigrationSpec, summary: WriteSummary | undefined): TerminalState {
  if (spec.verdict === "blocked") return "blocked";
  if (spec.verdict === "unaffected") return "unaffected";
  if (!summary || writeRunFailed(summary)) return "failed";
  if (spec.downstream_impacts.overall_rating === "HIGH") return "migrated_with_flags";
  return "migrated_verified";
}

function recordRun(
  runDir: string,
  slug: string,
  stage: PipelineStage,
  run: RunAgentResult,
): void {
  for (const ev of run.events) {
    appendEvent(runDir, {
      ts: nowIso(),
      repo: slug,
      stage,
      type: ev.type,
      message: ev.text ?? `${stage} event`,
      data: ev.data,
    });
  }
}

function liveSink(runDir: string, slug: string, stage: PipelineStage) {
  return (ev: { type: string; text?: string; data?: unknown }) => {
    appendEvent(runDir, {
      ts: nowIso(),
      repo: slug,
      stage,
      type: ev.type,
      message: ev.text ?? `${stage} event`,
      data: ev.data,
    });
  };
}

/**
 * One schema retry (D25 parse retry, not a model-tier escalation). Stub
 * fixtures already parse, so the second call is live-only in practice.
 */
async function runValidated<T>(
  opts: {
    repo: FleetRepo;
    workspace: string;
    prompt: string;
    mode: AgentMode;
    kind: "research" | "human-impact";
    runDir: string;
    stage: PipelineStage;
    httpHold?: HttpHold;
  },
  schema: ZodType<T>,
): Promise<T> {
  assertNotKilled(opts.httpHold);
  const base = {
    repo: opts.repo.slug,
    workspace: opts.workspace,
    mode: opts.mode,
    kind: opts.kind,
    githubUrl: opts.repo.github_url,
    startingRef: opts.repo.baseline_tag,
    onEvent: opts.mode === "live" ? liveSink(opts.runDir, opts.repo.slug, opts.stage) : undefined,
    ...agentCtl(opts.httpHold),
  };
  const first = await runReadOnlyAgent({ ...base, prompt: opts.prompt });
  if (opts.mode !== "live") recordRun(opts.runDir, opts.repo.slug, opts.stage, first);
  const parsed = schema.safeParse(first.result);
  if (parsed.success) return parsed.data;

  appendEvent(opts.runDir, {
    ts: nowIso(),
    repo: opts.repo.slug,
    stage: opts.stage,
    type: "schema_retry",
    message: parsed.error.message,
  });
  const second = await runReadOnlyAgent({
    ...base,
    prompt: `${opts.prompt}

---
Your previous output failed schema validation. Return ONLY a corrected JSON
object. Do not fence it. Issues:
${parsed.error.message}
`,
  });
  if (opts.mode !== "live") recordRun(opts.runDir, opts.repo.slug, opts.stage, second);
  return schema.parse(second.result);
}

async function researchPair(
  repo: FleetRepo,
  diffSummary: string,
  opts: PipelineOptions,
  runDir: string,
  manifest: RunManifest,
  schemas: DiffSchemas,
): Promise<MigrationSpec> {
  assertNotKilled(opts.httpHold);
  const cloud = opts.mode === "live" && useCloudAgents();
  const workspace =
    opts.mode === "live" && !cloud ? ensureClone(repo) : workspaceFor(repo.slug);
  const humanWorkspace =
    opts.mode === "live" && !cloud ? ensureBilboClone(repo) : workspaceFor(repo.slug);
  appendEvent(runDir, {
    ts: nowIso(),
    repo: repo.slug,
    stage: "research",
    type: "start",
    message: `LEGOLAS · ${researchModelFor(opts.mode)}`,
  });
  appendEvent(runDir, {
    ts: nowIso(),
    repo: repo.slug,
    stage: "human_impact",
    type: "start",
    message: `BILBO · ${humanImpactModelFor(opts.mode)}`,
  });
  const researchPrompt = renderResearchPrompt(
    repo.slug,
    diffSummary,
    schemas.fields,
    schemas.research,
    opts.businessContext,
  );
  const humanPrompt = renderHumanImpactPrompt(repo.slug, diffSummary);
  writePrompt(runDir, repo.slug, "research", researchPrompt);
  writePrompt(runDir, repo.slug, "human_impact", humanPrompt);
  const [research, human] = await Promise.all([
    runValidated(
      {
        repo,
        workspace,
        prompt: researchPrompt,
        mode: opts.mode,
        kind: "research",
        runDir,
        stage: "research",
        httpHold: opts.httpHold,
      },
      schemas.research,
    ),
    runValidated(
      {
        repo,
        workspace: humanWorkspace,
        prompt: humanPrompt,
        mode: opts.mode,
        kind: "human-impact",
        runDir,
        stage: "human_impact",
        httpHold: opts.httpHold,
      },
      HumanImpactSchema,
    ),
  ]);

  let hygiene: WorkspaceHygiene | undefined;
  if (opts.mode === "live" && !cloud) {
    const inspect = inspectResearchWorkspace(workspace);
    if (inspect.untracked.length > 0) {
      appendEvent(runDir, {
        ts: nowIso(),
        repo: repo.slug,
        stage: "hygiene",
        type: "workspace_clean",
        message: `cleaned untracked artifacts: ${inspect.untracked.join(", ")}`,
        data: { files: inspect.untracked },
      });
    }
    if (inspect.tracked.length > 0) {
      hygiene = {
        signal: "tracked_modifications",
        files: inspect.tracked,
        diff: inspect.diff || inspect.tracked.join("\n"),
      };
      writeFileSync(join(repoDir(runDir, repo.slug), "workspace-diff.patch"), inspect.diff);
      appendEvent(runDir, {
        ts: nowIso(),
        repo: repo.slug,
        stage: "hygiene",
        type: "workspace_hygiene",
        message: "research modified tracked files — spec flagged, human decides",
        data: { files: inspect.tracked },
      });
    }
  }

  writeJson(runDir, repo.slug, "research.json", research);
  writeJson(runDir, repo.slug, "human-impact.json", human);

  const merged = applyPolicies(mergeResearchAndHumanImpact(research, human));
  const spec: MigrationSpec = hygiene ? { ...merged, workspace_hygiene: hygiene } : merged;
  schemas.migration.parse(spec);
  writeJson(runDir, repo.slug, "spec.json", spec);

  const entry = manifest.repos[repo.slug];
  if (entry) {
    entry.research_model = researchModelFor(opts.mode);
    entry.human_impact_model = humanImpactModelFor(opts.mode);
  }
  touchStage(manifest, repo.slug, "research");
  touchStage(manifest, repo.slug, "human_impact");
  touchStage(manifest, repo.slug, "merge");
  touchStage(manifest, repo.slug, "validate");
  if (opts.mode === "live" && !useCloudAgents()) touchStage(manifest, repo.slug, "hygiene");
  writeManifest(runDir, manifest);
  return spec;
}

async function executeWrite(
  repo: FleetRepo,
  spec: MigrationSpec,
  diffSummary: string,
  opts: PipelineOptions,
  runDir: string,
  manifest: RunManifest,
  modelOverride?: string,
): Promise<WriteSummary> {
  assertNotKilled(opts.httpHold);
  if (spec.verdict !== "affected" || !spec.execution_grade) {
    throw new Error(`${repo.slug}: write requires verdict=affected and execution_grade`);
  }
  const grade = spec.execution_grade;
  const cloud = opts.mode === "live" && useCloudAgents();
  const workspace =
    opts.mode === "live" && !cloud
      ? prepareWriteWorkspace(repo, opts.v3Path ?? V3_SPEC_PATH)
      : workspaceFor(repo.slug);
  const promptBase = renderWritePrompt({
    repo: repo.slug,
    specJson: JSON.stringify(spec, null, 2),
    diffSummary,
    v3SpecPath:
      opts.mode === "live" && !cloud
        ? V3_SPEC_COPY
        : cloud
          ? "the TARGET SPEC section at the end of this prompt"
          : (opts.v3Path ?? V3_SPEC_PATH),
    retryBudget: INNER_RETRY_BUDGET,
    businessContext: opts.businessContext,
  });
  const prompt =
    cloud && opts.mode === "live"
      ? `${promptBase}\n\n# TARGET SPEC (v3)\n\`\`\`yaml\n${readFileSync(opts.v3Path ?? V3_SPEC_PATH, "utf8")}\n\`\`\`\n`
      : promptBase;
  writePrompt(runDir, repo.slug, "write", prompt);

  const first = await runWriteAgent({
    repo: repo.slug,
    workspace,
    prompt,
    mode: opts.mode,
    grade,
    modelOverride,
    githubUrl: repo.github_url,
    startingRef: repo.baseline_tag,
    autoCreatePR: opts.mode === "live" && useCloudAgents() && openRealPrs(),
    onEvent: opts.mode === "live" ? liveSink(runDir, repo.slug, "write") : undefined,
    ...agentCtl(opts.httpHold),
  });
  if (opts.mode !== "live") recordRun(runDir, repo.slug, "write", first);
  let summary = WriteSummarySchema.parse(first.result);
  let modelUsed: string = modelOverride ?? writeModelForGrade(grade, opts.mode);
  touchStage(manifest, repo.slug, "write");

  if (writeRunFailed(summary)) {
    const next = nextModelTier(modelUsed, opts.mode);
    if (next) {
      appendEvent(runDir, {
        ts: nowIso(),
        repo: repo.slug,
        stage: "escalate_write",
        type: "escalate",
        message: `inner loop exhausted; re-running once at ${next}`,
      });
      const second = await runWriteAgent({
        repo: repo.slug,
        workspace,
        prompt,
        mode: opts.mode,
        grade,
        modelOverride: next,
        githubUrl: repo.github_url,
        startingRef: repo.baseline_tag,
        autoCreatePR: opts.mode === "live" && useCloudAgents() && openRealPrs(),
        onEvent:
          opts.mode === "live" ? liveSink(runDir, repo.slug, "escalate_write") : undefined,
        ...agentCtl(opts.httpHold),
      });
      if (opts.mode !== "live") recordRun(runDir, repo.slug, "escalate_write", second);
      summary = WriteSummarySchema.parse(second.result);
      modelUsed = next;
      manifest.repos[repo.slug]!.escalated = true;
      touchStage(manifest, repo.slug, "escalate_write");
    }
  }

  for (const call of summary.judgment_calls) {
    appendEvent(runDir, {
      ts: nowIso(),
      repo: repo.slug,
      stage: "write",
      type: "judgment_call",
      message: call.what,
      data: call,
    });
  }

  manifest.repos[repo.slug]!.model_used = modelUsed;
  writeJson(runDir, repo.slug, "write-summary.json", summary);
  writeManifest(runDir, manifest);
  return summary;
}

function reuseSpecFromRun(
  fromRun: string,
  runDir: string,
  repo: FleetRepo,
  manifest: RunManifest,
  migrationSchema: DiffSchemas["migration"],
): MigrationSpec {
  const srcDir = join(STATE_DIR, fromRun, repo.slug);
  const specPath = join(srcDir, "spec.json");
  if (!existsSync(specPath)) {
    throw new Error(`--from-run ${fromRun} has no spec for ${repo.slug}`);
  }
  const spec = migrationSchema.parse(JSON.parse(readFileSync(specPath, "utf8")));
  for (const name of ["research.json", "human-impact.json", "spec.json"]) {
    const src = join(srcDir, name);
    if (existsSync(src)) copyFileSync(src, join(repoDir(runDir, repo.slug), name));
  }
  touchStage(manifest, repo.slug, "research");
  touchStage(manifest, repo.slug, "human_impact");
  touchStage(manifest, repo.slug, "merge");
  touchStage(manifest, repo.slug, "validate");
  appendEvent(runDir, {
    ts: nowIso(),
    repo: repo.slug,
    stage: "research",
    type: "reused",
    message: `spec reused from ${fromRun}`,
  });
  return spec;
}

function selectFleet(opts: PipelineOptions, fleet: Fleet): FleetRepo[] {
  const all = opts.mode === "live" ? researchConsumersOf(fleet, "M1") : consumersOf(fleet);
  if (!opts.repos?.length || opts.fromRun) return all;
  const wanted = new Set(opts.repos);
  return all.filter((r) => wanted.has(r.slug));
}

function markSkipped(
  manifest: RunManifest,
  slug: string,
  gate: "approved" | "rejected" | "skipped",
): void {
  const entry = manifest.repos[slug];
  if (!entry) return;
  entry.gate = gate;
  touchStage(manifest, slug, "gate");
}

function finalizeBlocked(
  runId: string,
  runDir: string,
  repo: FleetRepo,
  spec: MigrationSpec,
  manifest: RunManifest,
  gate: "approved" | "rejected" | "skipped",
): void {
  markSkipped(manifest, repo.slug, gate);
  const artifact = buildEscalation(
    repo,
    spec,
    "blocked",
    "Blocked specs skip write. Escalation is the terminal artifact — a human decides how to handle the quoted blocker.",
  );
  writeJson(runDir, repo.slug, "escalation.json", artifact);
  manifest.repos[repo.slug]!.terminal = "blocked";
  touchStage(manifest, repo.slug, "escalation_artifact");
  notify({ runId, repo: repo.slug, from: "gate", to: "blocked", at: nowIso() });
  writeManifest(runDir, manifest);
}

function finalizeUnaffected(
  runId: string,
  runDir: string,
  repo: FleetRepo,
  manifest: RunManifest,
  gate: "approved" | "rejected" | "skipped",
): void {
  markSkipped(manifest, repo.slug, gate);
  manifest.repos[repo.slug]!.terminal = "unaffected";
  notify({
    runId,
    repo: repo.slug,
    from: "gate",
    to: "unaffected",
    at: nowIso(),
  });
  writeManifest(runDir, manifest);
}

function finalizeRejected(
  runId: string,
  runDir: string,
  repo: FleetRepo,
  spec: MigrationSpec,
  manifest: RunManifest,
): void {
  const artifact = buildEscalation(
    repo,
    spec,
    "rejected",
    "Human rejected the spec at the gate; no write fan-out.",
  );
  writeJson(runDir, repo.slug, "escalation.json", artifact);
  manifest.repos[repo.slug]!.terminal = "failed";
  notify({ runId, repo: repo.slug, from: "gate", to: "failed", at: nowIso() });
  writeManifest(runDir, manifest);
}

function markResearchFailed(
  runId: string,
  runDir: string,
  repo: FleetRepo,
  manifest: RunManifest,
  err: unknown,
): void {
  const message = err instanceof Error ? err.message : String(err);
  appendEvent(runDir, {
    ts: nowIso(),
    repo: repo.slug,
    stage: "research",
    type: "pair_failed",
    message,
  });
  appendRunEvent(runDir, {
    ts: nowIso(),
    stage: "run",
    type: "repo_isolated",
    message: `${repo.slug} research pair failed; other repos continue: ${message}`,
    data: { slug: repo.slug, error: message },
  });
  const entry = manifest.repos[repo.slug];
  if (entry) {
    entry.terminal = "failed";
    entry.gate = "skipped";
  }
  notify({ runId, repo: repo.slug, from: "research", to: "failed", at: nowIso() });
  writeManifest(runDir, manifest);
  console.warn(`research pair failed (${repo.slug}): ${message}`);
}

async function writeLane(
  runId: string,
  runDir: string,
  repo: FleetRepo,
  spec: MigrationSpec,
  diffSummary: string,
  opts: PipelineOptions,
  manifest: RunManifest,
  modelOverride?: string,
): Promise<void> {
  appendEvent(runDir, {
    ts: nowIso(),
    repo: repo.slug,
    stage: "write",
    type: "start",
    message: `GIMLI · ${modelOverride ?? writeModelForGrade(spec.execution_grade!, opts.mode)}`,
  });
  const summary = await executeWrite(
    repo,
    spec,
    diffSummary,
    opts,
    runDir,
    manifest,
    modelOverride,
  );
  if (writeRunFailed(summary) && opts.mode === "live") {
    const artifact = buildEscalation(
      repo,
      spec,
      "write_failed",
      "Write agent exhausted inner retries (and outer escalate if any); no PR.",
    );
    writeJson(runDir, repo.slug, "escalation.json", artifact);
    touchStage(manifest, repo.slug, "escalation_artifact");
  } else if (opts.mode === "live" && openRealPrs() && !useCloudAgents()) {
    const pr = openPullRequest({ repo, workspace: workspaceFor(repo.slug), spec, summary });
    writeJson(runDir, repo.slug, "pr.json", pr);
    manifest.repos[repo.slug]!.pr_url = pr.url;
    touchStage(manifest, repo.slug, "pr");
  } else {
    const fakePr = buildFakePr(repo, spec, summary);
    writeJson(runDir, repo.slug, "fake-pr.json", fakePr);
    touchStage(manifest, repo.slug, "fake_pr");
  }
  const terminal = terminalFor(spec, summary);
  manifest.repos[repo.slug]!.terminal = terminal;
  notify({ runId, repo: repo.slug, from: "write", to: terminal, at: nowIso() });
  writeManifest(runDir, manifest);
}

function applyDecisionToSpec(spec: MigrationSpec, decision: HttpDecision): MigrationSpec {
  if (!decision.grade_override) return spec;
  return { ...spec, execution_grade: decision.grade_override };
}

function degradeFanout(
  runDir: string,
  manifest: RunManifest,
  kind: "research" | "write",
  from: Concurrency,
  to: Concurrency,
  reason: string,
): void {
  const slot = manifest.concurrency?.[kind];
  if (slot) manifest.concurrency![kind] = applyDegrade(slot, from, to, reason);
  appendRunEvent(runDir, {
    ts: nowIso(),
    stage: "run",
    type: "concurrency_degraded",
    message: `${kind} ${labelConcurrency(from)} → ${labelConcurrency(to)}: ${reason}`,
    data: { kind, from: labelConcurrency(from), to: labelConcurrency(to), reason },
  });
  writeManifest(runDir, manifest);
  console.warn(`concurrency degraded: ${kind} ${labelConcurrency(from)} → ${labelConcurrency(to)}`);
}

async function fanoutWrites(
  runId: string,
  runDir: string,
  toWrite: FleetRepo[],
  specs: Map<string, MigrationSpec>,
  diffSummary: string,
  opts: PipelineOptions,
  manifest: RunManifest,
  modelFor?: (slug: string) => string | undefined,
): Promise<void> {
  if (toWrite.length === 0) return;
  const concurrency = opts.writeConcurrency ?? "full";
  appendRunEvent(runDir, {
    ts: nowIso(),
    stage: "run",
    type: "write_fanout",
    message: `write_concurrency=${labelConcurrency(concurrency)} (${toWrite.length} repos)`,
    data: { requested: labelConcurrency(concurrency), items: toWrite.length },
  });
  const started = Date.now();
  await mapFanout(
    toWrite,
    concurrency,
    (repo) =>
      writeLane(
        runId,
        runDir,
        repo,
        specs.get(repo.slug)!,
        diffSummary,
        opts,
        manifest,
        modelFor?.(repo.slug),
      ),
    (from, to, reason) => degradeFanout(runDir, manifest, "write", from, to, reason),
  );
  manifest.timings = { ...manifest.timings, write_ms: Date.now() - started };
  writeManifest(runDir, manifest);
}

async function runHttpHold(
  runId: string,
  runDir: string,
  selected: FleetRepo[],
  specs: Map<string, MigrationSpec>,
  diffSummary: string,
  resolved: PipelineOptions,
  manifest: RunManifest,
  hold: HttpHold,
): Promise<void> {
  manifest.phase = "gate";
  writeManifest(runDir, manifest);

  const pending: FleetRepo[] = [];
  for (const repo of selected) {
    const spec = specs.get(repo.slug);
    if (!spec) continue;
    if (spec.verdict === "blocked") {
      finalizeBlocked(runId, runDir, repo, spec, manifest, "skipped");
      writeJson(runDir, repo.slug, "decision.json", {
        decision: "skipped",
        at: nowIso(),
      });
      continue;
    }
    if (spec.verdict === "unaffected" && !needsHumanDecision(spec)) {
      finalizeUnaffected(runId, runDir, repo, manifest, "skipped");
      writeJson(runDir, repo.slug, "decision.json", {
        decision: "skipped",
        at: nowIso(),
      });
      continue;
    }
    pending.push(repo);
  }

  const recorded = new Map<string, HttpDecision>();
  await Promise.all(
    pending.map(async (repo) => {
      const decision = await hold.waitForDecision(repo.slug);
      recorded.set(repo.slug, decision);
      const entry = manifest.repos[repo.slug]!;
      entry.gate = decision.decision;
      if (decision.note) entry.gate_note = decision.note;
      if (decision.grade_override) entry.grade_override = decision.grade_override;
      if (decision.model_override) entry.model_override = decision.model_override;
      touchStage(manifest, repo.slug, "gate");
      const next = applyDecisionToSpec(specs.get(repo.slug)!, decision);
      specs.set(repo.slug, next);
      writeJson(runDir, repo.slug, "spec.json", next);
      writeManifest(runDir, manifest);
    }),
  );

  await hold.waitForRelease();
  manifest.phase = "write";
  writeManifest(runDir, manifest);

  const approved = pending.filter((r) => recorded.get(r.slug)?.decision === "approved");
  const rejected = pending.filter((r) => recorded.get(r.slug)?.decision === "rejected");
  for (const repo of rejected) {
    const spec = specs.get(repo.slug)!;
    if (spec.verdict === "affected") {
      finalizeRejected(runId, runDir, repo, spec, manifest);
    } else {
      finalizeUnaffected(runId, runDir, repo, manifest, "rejected");
    }
  }

  const toWrite = approved.filter((r) => specs.get(r.slug)?.verdict === "affected");
  for (const repo of approved) {
    if (specs.get(repo.slug)?.verdict === "unaffected") {
      finalizeUnaffected(runId, runDir, repo, manifest, "approved");
    }
  }

  await fanoutWrites(
    runId,
    runDir,
    toWrite,
    specs,
    diffSummary,
    resolved,
    manifest,
    (slug) => recorded.get(slug)?.model_override,
  );
}

export async function runPipeline(opts: PipelineOptions): Promise<RunManifest> {
  const fleetPath = opts.fleetPath ?? FLEET_PATH;
  const fleet = loadFleet(fleetPath);
  const created = opts.existing ?? createRun(opts.mode);
  const { runId, dir, manifest } = created;
  manifest.mode = opts.mode;
  manifest.phase = "research";
  writeManifest(dir, manifest);
  if (opts.mode === "live" && !useCloudAgents()) ensureProducerClone();
  const v3Path = opts.v3Path ?? V3_SPEC_PATH;
  const v2Path = opts.v2Path ?? resolveV2Path(producerOf(fleet).slug, V2_SPEC_PATH);
  const resolved: PipelineOptions = {
    ...opts,
    v2Path,
    v3Path,
    fleetPath,
    businessContext: opts.businessContext ?? businessContextProse(fleet.business_context),
    researchConcurrency: opts.researchConcurrency ?? fleetResearchConcurrency(fleet),
    writeConcurrency: opts.writeConcurrency ?? fleetWriteConcurrency(fleet),
  };
  manifest.concurrency = {
    research: initialFanout(resolved.researchConcurrency ?? "full"),
    write: initialFanout(resolved.writeConcurrency ?? "full"),
  };
  const diff = diffOpenApi(v2Path, v3Path);
  const schemas: DiffSchemas = {
    research: researchSpecSchemaFor(diff.fields),
    migration: migrationSpecSchemaFor(diff.fields),
    fields: diff.fields,
  };
  manifest.diff_summary = diff.summary;
  writeRunJson(dir, "diff.json", diff);
  writeRunJson(dir, "inputs.json", {
    v2: v2Path,
    v3: v3Path,
    fleet: fleetPath,
    producer: fleet.producer,
  });
  copyFileSync(fleetPath, join(dir, "fleet.json"));
  writeManifest(dir, manifest);
  console.log(diff.summary);
  console.log(`breaking fields (from diff): ${diff.fields.join(", ")}`);

  const selected = selectFleet(resolved, fleet);
  const rerun = new Set(opts.repos ?? []);
  if (rerun.size > 0) {
    for (const slug of rerun) {
      if (!selected.some((r) => r.slug === slug)) {
        throw new Error(`--repos ${slug} is not in the live M1 consumer set`);
      }
    }
  }
  for (const repo of selected) {
    manifest.repos[repo.slug] = {
      slug: repo.slug,
      display_name: repo.display_name,
      stages: ["diff"],
      research_model: researchModelFor(opts.mode),
      human_impact_model: humanImpactModelFor(opts.mode),
    };
  }
  writeManifest(dir, manifest);

  const specs = new Map<string, MigrationSpec>();
  const shouldResearch = (slug: string): boolean => {
    if (opts.fromRun && rerun.size === 0) return false;
    if (opts.fromRun && rerun.size > 0) return rerun.has(slug);
    return true;
  };
  const toResearch: FleetRepo[] = [];
  for (const repo of selected) {
    if (!shouldResearch(repo.slug)) {
      if (!opts.fromRun) throw new Error(`missing spec for ${repo.slug}`);
      specs.set(repo.slug, reuseSpecFromRun(opts.fromRun, dir, repo, manifest, schemas.migration));
      continue;
    }
    toResearch.push(repo);
  }
  const researchConcurrency = resolved.researchConcurrency ?? "full";
  appendRunEvent(dir, {
    ts: nowIso(),
    stage: "run",
    type: "research_fanout",
    message: `research_concurrency=${labelConcurrency(researchConcurrency)} (${toResearch.length} pairs, ${toResearch.length * 2} agents)`,
    data: {
      requested: labelConcurrency(researchConcurrency),
      pairs: toResearch.length,
      agents: toResearch.length * 2,
    },
  });
  const researchStarted = Date.now();
  await mapFanout(
    toResearch,
    researchConcurrency,
    async (repo) => {
      try {
        const spec = await researchPair(repo, diff.summary, resolved, dir, manifest, schemas);
        specs.set(repo.slug, spec);
      } catch (err) {
        if (isCapacityError(err) || isPipelineKilled(err)) throw err;
        markResearchFailed(runId, dir, repo, manifest, err);
      }
    },
    (from, to, reason) => degradeFanout(dir, manifest, "research", from, to, reason),
  );
  manifest.timings = { ...manifest.timings, research_ms: Date.now() - researchStarted };
  writeManifest(dir, manifest);

  if (opts.httpHold) {
    try {
      await runHttpHold(
        runId,
        dir,
        selected,
        specs,
        diff.summary,
        resolved,
        manifest,
        opts.httpHold,
      );
    } catch (err) {
      manifest.phase = "failed";
      manifest.error = err instanceof Error ? err.message : String(err);
      writeManifest(dir, manifest);
      throw err;
    }
  } else {
    const toWrite: FleetRepo[] = [];
    for (const repo of selected) {
      const spec = specs.get(repo.slug);
      if (!spec) continue;
      const decision = await runGate({ repo, spec, autoApprove: opts.autoApprove });
      manifest.repos[repo.slug]!.gate = decision;
      touchStage(manifest, repo.slug, "gate");
      writeManifest(dir, manifest);

      if (spec.verdict === "blocked") {
        finalizeBlocked(runId, dir, repo, spec, manifest, decision);
        continue;
      }

      if (spec.verdict === "unaffected") {
        finalizeUnaffected(runId, dir, repo, manifest, decision);
        continue;
      }

      if (opts.until === "gate") {
        writeManifest(dir, manifest);
        continue;
      }

      if (decision !== "approved") {
        finalizeRejected(runId, dir, repo, spec, manifest);
        continue;
      }

      toWrite.push(repo);
    }
    if (opts.until !== "gate") {
      await fanoutWrites(runId, dir, toWrite, specs, diff.summary, resolved, manifest);
    }
  }

  for (const repo of selected) {
    const entry = manifest.repos[repo.slug];
    if (entry && !entry.stages.includes("report")) entry.stages.push("report");
  }
  manifest.phase = "done";
  manifest.finishedAt = nowIso();
  writeManifest(dir, manifest);

  printReport(manifest, opts, specs, schemas.migration);
  return manifest;
}

function printReport(
  manifest: RunManifest,
  opts: PipelineOptions,
  specs: Map<string, MigrationSpec>,
  migrationSchema: DiffSchemas["migration"],
): void {
  console.log("\n" + "═".repeat(72));
  console.log(
    `Command Center run ${manifest.runId}  mode=${manifest.mode}  until=${opts.until}`,
  );
  const researchMs = manifest.timings?.research_ms;
  const writeMs = manifest.timings?.write_ms;
  const rc = manifest.concurrency?.research;
  const wc = manifest.concurrency?.write;
  if (researchMs !== undefined) {
    console.log(
      `research wall-clock ${researchMs}ms  concurrency=${rc ? labelConcurrency(rc.effective) : "—"}` +
        (rc?.degraded ? `  degraded ${rc.ladder.join(" → ")}` : ""),
    );
  }
  if (writeMs !== undefined) {
    console.log(
      `write wall-clock ${writeMs}ms  concurrency=${wc ? labelConcurrency(wc.effective) : "—"}` +
        (wc?.degraded ? `  degraded ${wc.ladder.join(" → ")}` : ""),
    );
  }
  console.log("═".repeat(72));
  let valid = 0;
  for (const entry of Object.values(manifest.repos)) {
    const spec = specs.get(entry.slug);
    const parsed = spec ? migrationSchema.safeParse(spec) : undefined;
    if (parsed?.success) valid += 1;
    const grade = spec?.execution_grade ?? "—";
    const blockers =
      spec?.blockers.length
        ? spec.blockers
            .map((b) => `${b.class} ${b.evidence.file}:${b.evidence.line}`)
            .join("; ")
        : "none";
    const high = (spec?.downstream_impacts.findings ?? [])
      .filter((f) => f.rating === "HIGH")
      .map((f) => `${f.kind}: ${f.summary}`)
      .join("; ");
    const proof =
      spec?.verdict === "unaffected"
        ? spec.evidence.map((e) => `${e.file}:${e.line}`).join("; ")
        : "";
    console.log(
      `  ${entry.display_name.padEnd(14)} verdict=${(spec?.verdict ?? "—").padEnd(11)} grade=${String(grade).padEnd(16)} gate=${entry.gate ?? "—"}`,
    );
    console.log(`    blockers: ${blockers}`);
    if (high) console.log(`    HIGH: ${high}`);
    if (proof) console.log(`    proof: ${proof}`);
    console.log(`    schema: ${parsed?.success ? "valid" : "INVALID"}`);
    if (spec?.workspace_hygiene) {
      console.log(`    hygiene: tracked ${spec.workspace_hygiene.files.join(", ")}`);
    }
    if (entry.pr_url) console.log(`    pr: ${entry.pr_url}`);
    if (entry.terminal) console.log(`    terminal: ${entry.terminal}`);
  }
  console.log(`\n  schema-valid: ${valid}/${Object.keys(manifest.repos).length}`);
  console.log(`\nstate: state/${manifest.runId}/`);
  if (opts.until === "gate") {
    console.log("stopped at gate — write fan-out is M2.");
  } else if (opts.mode === "live") {
    console.log("live PRs are open; do not merge.");
  } else {
    console.log("fake PRs are JSON artifacts — no GitHub calls in stub mode.");
  }
}
