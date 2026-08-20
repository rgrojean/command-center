import { z } from "zod";
import { breakingFieldEnum, EvidenceSchema } from "./evidence.ts";
import { DownstreamImpactsSchema } from "./human-impact-schema.ts";

export const VerdictSchema = z.enum(["affected", "unaffected", "blocked"]);
export type Verdict = z.infer<typeof VerdictSchema>;

/** D20. Config maps this onto a write-agent model; the gate may override. */
export const ExecutionGradeSchema = z.enum([
  "mechanical",
  "contextual",
  "judgment_heavy",
]);
export type ExecutionGrade = z.infer<typeof ExecutionGradeSchema>;

export function callSiteSchema(fields: string[]) {
  return z.object({
    file: z.string().min(1),
    line: z.number().int().positive(),
    field: breakingFieldEnum(fields),
    /** How the field is used at this site: validate, persist, render, transmit, … */
    usage: z.string().min(1),
  });
}
export type CallSite = z.infer<ReturnType<typeof callSiteSchema>>;

export const PersistenceRecordSchema = z.object({
  store: z.string().min(1),
  ddl_evidence: EvidenceSchema,
  write_path_evidence: EvidenceSchema,
});
export type PersistenceRecord = z.infer<typeof PersistenceRecordSchema>;

export const RequiredChangeSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  files: z.array(z.string().min(1)).min(1),
  evidence: EvidenceSchema,
});
export type RequiredChange = z.infer<typeof RequiredChangeSchema>;

export const ExistingTestImpactSchema = z.object({
  name: z.string().min(1),
  file: z.string().min(1),
  will_break: z.boolean(),
  why: z.string().min(1),
  evidence: EvidenceSchema,
});

export const RecommendedNewTestSchema = z.object({
  name: z.string().min(1),
  /** How a reviewer would watch this test fail against pre-migration behavior. */
  fails_first_because: z.string().min(1),
});

export const TestImpactSchema = z.object({
  existing_tests: z.array(ExistingTestImpactSchema),
  recommended_new_tests: z.array(RecommendedNewTestSchema),
});
export type TestImpact = z.infer<typeof TestImpactSchema>;

export const BlockerClassSchema = z
  .enum(["organizational", "technical_coordinated"])
  .describe(
    "organizational: unresolvable in this repo (statutory/payer, missing services, credentials/approvals) → forces verdict blocked. technical_coordinated: resolvable in this repo as coordinated changes in one PR (e.g. schema migration + write path + views) → verdict stays affected; required_changes must sequence the steps.",
  );
export type BlockerClass = z.infer<typeof BlockerClassSchema>;

export const BlockerSchema = z.object({
  summary: z.string().min(1),
  /**
   * D28. organizational = cannot be resolved by edits in this repo (forces
   * verdict blocked). technical_coordinated = in-repo work that must ship
   * together (does not force blocked; verdict stays affected).
   */
  class: BlockerClassSchema,
  /** Verbatim quote is the whole point — a blocker without a quote is an opinion. */
  evidence: EvidenceSchema,
});
export type Blocker = z.infer<typeof BlockerSchema>;

export const ObservabilityGapSchema = z.object({
  deficiency: z.string().min(1),
  evidence: EvidenceSchema,
  recommended_instrumentation: z.string().min(1),
  /**
   * D18: the agent must assert the recommendation does not log the fields
   * being minimized (the breaking fields from the diff). A missing assertion
   * fails schema.
   */
  phi_safe: z.literal(true),
});

export const ProductionVerificationSchema = z.object({
  gaps: z.array(ObservabilityGapSchema),
});
export type ProductionVerification = z.infer<typeof ProductionVerificationSchema>;

export const ConfidenceSchema = z.object({
  score: z.number().min(0).max(1),
  rationale: z.string().min(1),
});

/**
 * Orchestrator annotation (D32), never agent-emitted. Tracked-file edits
 * during research are a gate-visible policy signal — they do not overwrite
 * verdict (D23).
 */
export const WorkspaceHygieneSchema = z.object({
  signal: z.literal("tracked_modifications"),
  files: z.array(z.string().min(1)).min(1),
  diff: z.string().min(1),
});
export type WorkspaceHygiene = z.infer<typeof WorkspaceHygieneSchema>;

function researchSpecObjectSchema(fields: string[]) {
  return z.object({
    repo: z.string().min(1),
    verdict: VerdictSchema,
    call_sites: z.array(callSiteSchema(fields)),
    persistence: z.array(PersistenceRecordSchema),
    required_changes: z.array(RequiredChangeSchema),
    test_impact: TestImpactSchema,
    blockers: z.array(BlockerSchema),
    production_verification: ProductionVerificationSchema,
    execution_grade: ExecutionGradeSchema.optional(),
    grade_reasoning: z.string().min(1).optional(),
    confidence: ConfidenceSchema,
    evidence: z.array(EvidenceSchema),
  });
}

/** D27 + D28 — blocked iff organizational blockers; unaffected needs proof; grade only when affected. */
function withSpecConsistency<T extends z.ZodType>(schema: T) {
  return schema.superRefine((value, ctx) => {
    const spec = value as z.infer<ReturnType<typeof researchSpecObjectSchema>>;
    const blocked = spec.verdict === "blocked";
    const organizational = spec.blockers.filter((b) => b.class === "organizational");
    const coordinated = spec.blockers.filter((b) => b.class === "technical_coordinated");
    const hasOrganizational = organizational.length >= 1;
    if (blocked !== hasOrganizational) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: blocked
          ? 'verdict "blocked" requires at least one organizational blocker'
          : "organizational blockers require verdict \"blocked\"",
        path: blocked ? ["blockers"] : ["verdict"],
      });
    }
    if (coordinated.length >= 1 && spec.required_changes.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "technical_coordinated blockers require required_changes that sequence the coordinated steps",
        path: ["required_changes"],
      });
    }
    if (spec.verdict === "unaffected" && spec.evidence.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'verdict "unaffected" requires evidence.length >= 1 (cite why — proof of absence)',
        path: ["evidence"],
      });
    }
    if (spec.verdict === "affected") {
      if (!spec.execution_grade) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'execution_grade is required when verdict is "affected"',
          path: ["execution_grade"],
        });
      }
      if (!spec.grade_reasoning) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'grade_reasoning is required when verdict is "affected"',
          path: ["grade_reasoning"],
        });
      }
    }
  });
}

/**
 * Research-agent output: the full spec minus `downstream_impacts`.
 * Human-impact owns that object; splicing it in is the orchestrator's job (D23).
 * D30: pass `fields` from the diff — do not hardcode them here.
 */
export function researchSpecSchemaFor(fields: string[]) {
  return withSpecConsistency(researchSpecObjectSchema(fields));
}
export type ResearchSpec = z.infer<ReturnType<typeof researchSpecObjectSchema>>;

/** Merged, gate-reviewed artifact. One of these per consumer repo. */
export function migrationSpecSchemaFor(fields: string[]) {
  return withSpecConsistency(
    researchSpecObjectSchema(fields).extend({
      downstream_impacts: DownstreamImpactsSchema,
      workspace_hygiene: WorkspaceHygieneSchema.optional(),
    }),
  );
}
export type MigrationSpec = ResearchSpec & {
  downstream_impacts: z.infer<typeof DownstreamImpactsSchema>;
  workspace_hygiene?: WorkspaceHygiene;
};

/** Affected always; unaffected only when research edited tracked files. */
export function needsHumanDecision(spec: MigrationSpec): boolean {
  if (spec.verdict === "affected") return true;
  return spec.verdict === "unaffected" && spec.workspace_hygiene !== undefined;
}
