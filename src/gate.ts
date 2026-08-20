import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { FleetRepo } from "./fleet.js";
import type { MigrationSpec } from "./spec-schema.js";

export type GateDecision = "approved" | "rejected";

function renderSpec(repo: FleetRepo, spec: MigrationSpec): string {
  const lines = [
    "",
    "═".repeat(72),
    `${repo.display_name}  (${spec.repo})`,
    "═".repeat(72),
    `verdict:          ${spec.verdict}`,
    `execution_grade:  ${spec.execution_grade ?? "(n/a — not affected)"}`,
    `grade_reasoning:  ${spec.grade_reasoning ?? "(n/a)"}`,
    `confidence:       ${spec.confidence.score} — ${spec.confidence.rationale}`,
    `human impact:     ${spec.downstream_impacts.overall_rating} — ${spec.downstream_impacts.rating_rationale}`,
    "",
    "call_sites:",
    ...spec.call_sites.map(
      (c) => `  - ${c.field} @ ${c.file}:${c.line} (${c.usage})`,
    ),
    "",
    "persistence:",
    ...(spec.persistence.length
      ? spec.persistence.map(
          (p) =>
            `  - ${p.store}\n      DDL: ${p.ddl_evidence.file}:${p.ddl_evidence.line ?? "?"}\n      write: ${p.write_path_evidence.file}:${p.write_path_evidence.line ?? "?"}`,
        )
      : ["  (none)"]),
    "",
    "required_changes:",
    ...(spec.required_changes.length
      ? spec.required_changes.map((c) => `  - [${c.id}] ${c.description}`)
      : ["  (none)"]),
    "",
    "blockers:",
    ...(spec.blockers.length
      ? spec.blockers.map(
          (b) =>
            `  - [${b.class}] ${b.summary}\n      "${b.evidence.quote}" (${b.evidence.file}:${b.evidence.line})`,
        )
      : ["  (none)"]),
    "",
    "test_impact:",
    ...spec.test_impact.existing_tests.map(
      (t) => `  - ${t.will_break ? "BREAKS" : "ok"} ${t.name} — ${t.why}`,
    ),
    ...spec.test_impact.recommended_new_tests.map(
      (t) => `  - NEW ${t.name} (fails first: ${t.fails_first_because})`,
    ),
    "",
    "downstream_impacts.findings:",
    ...(spec.downstream_impacts.findings.length
      ? spec.downstream_impacts.findings.map(
          (f) => `  - [${f.rating}] ${f.kind}: ${f.summary}`,
        )
      : ["  (none)"]),
    "",
    "production_verification.gaps:",
    ...(spec.production_verification.gaps.length
      ? spec.production_verification.gaps.map(
          (g) => `  - ${g.deficiency} → ${g.recommended_instrumentation}`,
        )
      : ["  (none)"]),
    "─".repeat(72),
  ];
  if (spec.workspace_hygiene) {
    lines.splice(
      lines.length - 1,
      0,
      "",
      "workspace_hygiene (tracked files modified during research — verdict unchanged):",
      ...spec.workspace_hygiene.files.map((f) => `  - ${f}`),
      spec.workspace_hygiene.diff.trim()
        ? `--- diff ---\n${spec.workspace_hygiene.diff}`
        : "",
    );
  }
  return lines.join("\n");
}

/**
 * The spec is the reviewed artifact. `--yes` / stub-default auto-approve
 * still prints every section so a rehearsal run is inspectable.
 * Blocked specs are not write-candidates even if the human types y —
 * write fan-out honors verdict separately (D16).
 */
export async function runGate(opts: {
  repo: FleetRepo;
  spec: MigrationSpec;
  autoApprove: boolean;
}): Promise<GateDecision> {
  output.write(renderSpec(opts.repo, opts.spec) + "\n");
  if (opts.autoApprove) {
    output.write(`gate: auto-approved (${opts.repo.slug})\n`);
    return "approved";
  }
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(
      `Approve migration spec for ${opts.repo.display_name}? [y/N] `,
    );
    return /^y(es)?$/i.test(answer.trim()) ? "approved" : "rejected";
  } finally {
    rl.close();
  }
}
