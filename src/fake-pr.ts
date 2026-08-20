import type { FleetRepo } from "./fleet.js";
import type { MigrationSpec } from "./spec-schema.js";
import type { WriteSummary } from "./write-summary-schema.js";

export type FakePullRequest = {
  stub: true;
  repo: string;
  github_url: string;
  branch: string;
  title: string;
  body: string;
  url: string;
};

export function prTitle(repo: FleetRepo): string {
  return `migrate ${repo.display_name} onto producer spec v3`;
}

export function prBody(
  spec: MigrationSpec,
  summary: WriteSummary,
  footer = "_Opened by Command Center. Do not merge; CODEOWNERS review required._",
): string {
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
    footer,
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
    branch: "migration/spec-v3",
    title: prTitle(repo),
    body: prBody(
      spec,
      summary,
      "_Stub PR — M2 opens a real GitHub PR via `gh`. Do not merge; CODEOWNERS review required._",
    ),
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
  /** Who owns the decision (blocked specs). */
  routing?: string;
  cited_evidence?: Array<{ file: string; line?: number; quote: string }>;
  human_findings?: Array<{
    rating: string;
    kind: string;
    summary: string;
  }>;
};

export function buildEscalation(
  repo: FleetRepo,
  spec: MigrationSpec,
  reason: EscalationArtifact["reason"],
  note: string,
  extra?: Pick<EscalationArtifact, "routing">,
): EscalationArtifact {
  const cited = [
    ...spec.blockers.map((b) => ({
      file: b.evidence.file,
      line: b.evidence.line,
      quote: b.evidence.quote,
    })),
    ...spec.evidence.map((e) => ({
      file: e.file,
      line: e.line,
      quote: e.quote,
    })),
  ];
  const seen = new Set<string>();
  const cited_evidence = cited.filter((e) => {
    const key = `${e.file}:${e.line}:${e.quote}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    repo: repo.slug,
    display_name: repo.display_name,
    reason,
    blockers: spec.blockers,
    human_impact: spec.downstream_impacts.overall_rating,
    note,
    routing: extra?.routing,
    cited_evidence,
    human_findings: spec.downstream_impacts.findings.map((f) => ({
      rating: f.rating,
      kind: f.kind,
      summary: f.summary,
    })),
  };
}
