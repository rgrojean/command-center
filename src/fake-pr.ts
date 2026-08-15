import type { FleetRepo } from "./fleet.ts";
import type { MigrationSpec } from "./spec-schema.ts";
import type { WriteSummary } from "./write-summary-schema.ts";

export type FakePullRequest = {
  stub: true;
  repo: string;
  github_url: string;
  branch: "migration/pis-v3";
  title: string;
  body: string;
  url: string;
};

function prBody(spec: MigrationSpec, summary: WriteSummary): string {
  const what = spec.required_changes.map((c) => `- ${c.description}`).join("\n");
  const evidence = spec.evidence
    .map((e) => `- ${e.file}${e.line ? `:${e.line}` : ""} — "${e.quote}"`)
    .join("\n");
  const tests = summary.test_runs
    .map(
      (t) =>
        `- attempt ${t.attempt}: ${t.failures.length ? t.failures.join("; ") : "green"} → ${t.resolution}`,
    )
    .join("\n");
  const human = spec.downstream_impacts.findings
    .map((f) => `- [${f.rating}] ${f.summary}`)
    .join("\n");
  const notes = summary.human_impact_notes
    .map((n) => `- ${n.finding}: ${n.note}`)
    .join("\n");
  return [
    "## What",
    what || "(no required_changes)",
    "",
    "## Why",
    spec.grade_reasoning,
    "",
    "## Evidence",
    evidence || "(none)",
    "",
    "## Test results",
    tests || "(none)",
    "",
    "## Human-impact assessment",
    `Overall: ${spec.downstream_impacts.overall_rating} — ${spec.downstream_impacts.rating_rationale}`,
    human || "(no findings)",
    notes ? `\n### Write-agent notes\n${notes}` : "",
    "",
    "_Stub PR — M2 opens a real GitHub PR via `gh`. Do not merge; CODEOWNERS review required._",
  ].join("\n");
}

/** M0 stand-in for `gh pr create`. JSON artifact only — never talks to GitHub. */
export function buildFakePr(
  repo: FleetRepo,
  spec: MigrationSpec,
  summary: WriteSummary,
): FakePullRequest {
  return {
    stub: true,
    repo: repo.slug,
    github_url: repo.github_url,
    branch: "migration/pis-v3",
    title: `migrate ${repo.display_name} onto PIS v3`,
    body: prBody(spec, summary),
    url: `${repo.github_url}/pull/stub-${spec.repo}`,
  };
}

export type EscalationArtifact = {
  repo: string;
  display_name: string;
  reason: "blocked" | "rejected" | "write_failed";
  blockers: MigrationSpec["blockers"];
  human_impact: MigrationSpec["downstream_impacts"]["overall_rating"];
  note: string;
};

export function buildEscalation(
  repo: FleetRepo,
  spec: MigrationSpec,
  reason: EscalationArtifact["reason"],
  note: string,
): EscalationArtifact {
  return {
    repo: repo.slug,
    display_name: repo.display_name,
    reason,
    blockers: spec.blockers,
    human_impact: spec.downstream_impacts.overall_rating,
    note,
  };
}
