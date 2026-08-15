import { join } from "node:path";
import { runReadOnlyAgent, runWriteAgent } from "./agents.ts";
import { diffPisV2V3 } from "./diff.ts";
import { consumers, type FleetRepo } from "./fleet.ts";
import { buildEscalation, buildFakePr } from "./fake-pr.ts";
import { runGate } from "./gate.ts";
import { mergeResearchAndHumanImpact } from "./merge.ts";
import { nextModelTier, writeModelForGrade } from "./models.ts";
import { notify } from "./notifier.ts";
import { applyPolicies } from "./policies.ts";
import {
  renderHumanImpactPrompt,
  renderResearchPrompt,
  renderWritePrompt,
} from "./prompts.ts";
import { WORKSPACES_DIR } from "./paths.ts";
import type { AgentMode } from "./run-agent.ts";
import { HumanImpactSchema } from "./human-impact-schema.ts";
import {
  MigrationSpecSchema,
  ResearchSpecSchema,
  type MigrationSpec,
} from "./spec-schema.ts";
import {
  appendEvent,
  createRun,
  nowIso,
  touchStage,
  writeJson,
  writeManifest,
  type RunManifest,
} from "./state.ts";
import type { TerminalState } from "./terminal-states.ts";
import { WriteSummarySchema, writeRunFailed, type WriteSummary } from "./write-summary-schema.ts";

const INNER_RETRY_BUDGET = 3;

export type PipelineOptions = {
  mode: AgentMode;
  autoApprove: boolean;
};

function workspaceFor(slug: string): string {
  // M1 clones here at baseline-v2. M0 stub never touches it.
  return join(WORKSPACES_DIR, slug);
}

function terminalFor(spec: MigrationSpec, summary: WriteSummary | undefined): TerminalState {
  if (spec.verdict === "blocked") return "blocked";
  if (spec.verdict === "unaffected") return "unaffected";
  if (!summary || writeRunFailed(summary)) return "failed";
  if (spec.downstream_impacts.overall_rating === "HIGH") return "migrated_with_flags";
  return "migrated_verified";
}

async function researchPair(
  repo: FleetRepo,
  diffSummary: string,
  opts: PipelineOptions,
  runDir: string,
  manifest: RunManifest,
): Promise<MigrationSpec> {
  const workspace = workspaceFor(repo.slug);
  const [researchRun, humanRun] = await Promise.all([
    runReadOnlyAgent({
      repo: repo.slug,
      workspace,
      prompt: renderResearchPrompt(repo.slug, diffSummary),
      mode: opts.mode,
      kind: "research",
    }),
    runReadOnlyAgent({
      repo: repo.slug,
      workspace,
      prompt: renderHumanImpactPrompt(repo.slug, diffSummary),
      mode: opts.mode,
      kind: "human-impact",
    }),
  ]);

  for (const ev of researchRun.events) {
    appendEvent(runDir, {
      ts: nowIso(),
      repo: repo.slug,
      stage: "research",
      type: ev.type,
      message: ev.text ?? "research event",
      data: ev.data,
    });
  }
  for (const ev of humanRun.events) {
    appendEvent(runDir, {
      ts: nowIso(),
      repo: repo.slug,
      stage: "human_impact",
      type: ev.type,
      message: ev.text ?? "human-impact event",
      data: ev.data,
    });
  }

  const research = ResearchSpecSchema.parse(researchRun.result);
  const human = HumanImpactSchema.parse(humanRun.result);
  writeJson(runDir, repo.slug, "research.json", research);
  writeJson(runDir, repo.slug, "human-impact.json", human);

  const spec = applyPolicies(mergeResearchAndHumanImpact(research, human));
  MigrationSpecSchema.parse(spec);
  writeJson(runDir, repo.slug, "spec.json", spec);

  touchStage(manifest, repo.slug, "research");
  touchStage(manifest, repo.slug, "human_impact");
  touchStage(manifest, repo.slug, "merge");
  touchStage(manifest, repo.slug, "validate");
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
): Promise<WriteSummary> {
  const workspace = workspaceFor(repo.slug);
  const prompt = renderWritePrompt({
    repo: repo.slug,
    specJson: JSON.stringify(spec, null, 2),
    diffSummary,
    v3SpecPath: "specs/pis-openapi-v3.yaml",
    retryBudget: INNER_RETRY_BUDGET,
  });

  const first = await runWriteAgent({
    repo: repo.slug,
    workspace,
    prompt,
    mode: opts.mode,
    grade: spec.execution_grade,
  });
  for (const ev of first.events) {
    appendEvent(runDir, {
      ts: nowIso(),
      repo: repo.slug,
      stage: "write",
      type: ev.type,
      message: ev.text ?? "write event",
      data: ev.data,
    });
  }
  let summary = WriteSummarySchema.parse(first.result);
  let modelUsed: string = writeModelForGrade(spec.execution_grade);
  touchStage(manifest, repo.slug, "write");

  // Outer loop (D25): one re-run at the next model tier if the inner ≤3
  // test-fix attempts still left failures or incomplete spec items.
  if (writeRunFailed(summary)) {
    const next = nextModelTier(modelUsed);
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
        grade: spec.execution_grade,
        modelOverride: next,
      });
      for (const ev of second.events) {
        appendEvent(runDir, {
          ts: nowIso(),
          repo: repo.slug,
          stage: "escalate_write",
          type: ev.type,
          message: ev.text ?? "escalated write event",
        });
      }
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

export async function runPipeline(opts: PipelineOptions): Promise<RunManifest> {
  const { runId, dir, manifest } = createRun(opts.mode);
  const diff = diffPisV2V3();
  manifest.diff_summary = diff.summary;
  writeManifest(dir, manifest);

  const fleet = consumers();
  for (const repo of fleet) {
    manifest.repos[repo.slug] = {
      slug: repo.slug,
      display_name: repo.display_name,
      stages: ["diff"],
    };
  }
  writeManifest(dir, manifest);

  // Fan-out independent research pairs (cookbook idiom: Promise.all, not a DAG).
  const specs = new Map<string, MigrationSpec>();
  await Promise.all(
    fleet.map(async (repo) => {
      const spec = await researchPair(repo, diff.summary, opts, dir, manifest);
      specs.set(repo.slug, spec);
    }),
  );

  // Gate is sequential — one human, one spec at a time.
  for (const repo of fleet) {
    const spec = specs.get(repo.slug);
    if (!spec) throw new Error(`missing spec for ${repo.slug}`);
    const decision = await runGate({ repo, spec, autoApprove: opts.autoApprove });
    manifest.repos[repo.slug]!.gate = decision;
    touchStage(manifest, repo.slug, "gate");
    writeManifest(dir, manifest);

    if (spec.verdict === "blocked") {
      const artifact = buildEscalation(
        repo,
        spec,
        "blocked",
        "Blocked specs skip write. Escalation is the terminal artifact — a human decides how to handle the quoted blocker.",
      );
      writeJson(dir, repo.slug, "escalation.json", artifact);
      manifest.repos[repo.slug]!.terminal = "blocked";
      touchStage(manifest, repo.slug, "escalation_artifact");
      notify({ runId, repo: repo.slug, from: "gate", to: "blocked", at: nowIso() });
      writeManifest(dir, manifest);
      continue;
    }

    if (spec.verdict === "unaffected") {
      manifest.repos[repo.slug]!.terminal = "unaffected";
      notify({
        runId,
        repo: repo.slug,
        from: "gate",
        to: "unaffected",
        at: nowIso(),
      });
      writeManifest(dir, manifest);
      continue;
    }

    if (decision !== "approved") {
      const artifact = buildEscalation(
        repo,
        spec,
        "rejected",
        "Human rejected the spec at the gate; no write fan-out.",
      );
      writeJson(dir, repo.slug, "escalation.json", artifact);
      manifest.repos[repo.slug]!.terminal = "failed";
      notify({ runId, repo: repo.slug, from: "gate", to: "failed", at: nowIso() });
      writeManifest(dir, manifest);
      continue;
    }

    const summary = await executeWrite(repo, spec, diff.summary, opts, dir, manifest);
    const fakePr = buildFakePr(repo, spec, summary);
    writeJson(dir, repo.slug, "fake-pr.json", fakePr);
    touchStage(manifest, repo.slug, "fake_pr");
    const terminal = terminalFor(spec, summary);
    manifest.repos[repo.slug]!.terminal = terminal;
    notify({ runId, repo: repo.slug, from: "write", to: terminal, at: nowIso() });
    writeManifest(dir, manifest);
  }

  for (const repo of fleet) {
    const entry = manifest.repos[repo.slug];
    if (entry && !entry.stages.includes("report")) entry.stages.push("report");
  }
  manifest.finishedAt = nowIso();
  writeManifest(dir, manifest);

  printReport(manifest);
  return manifest;
}

function printReport(manifest: RunManifest): void {
  console.log("\n" + "═".repeat(72));
  console.log(`Command Center run ${manifest.runId}  mode=${manifest.mode}`);
  console.log("═".repeat(72));
  for (const entry of Object.values(manifest.repos)) {
    console.log(
      `  ${entry.display_name.padEnd(14)} ${String(entry.terminal ?? "—").padEnd(22)} gate=${entry.gate ?? "—"}`,
    );
  }
  console.log(`\nstate: state/${manifest.runId}/`);
  console.log("fake PRs are JSON artifacts — no GitHub calls in stub mode.");
}
