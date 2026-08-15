import { z } from "zod";
import { BreakingFieldSchema, EvidenceSchema } from "./evidence.ts";
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

export const CallSiteSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive(),
  field: BreakingFieldSchema,
  /** How the field is used at this site: validate, persist, render, transmit, … */
  usage: z.string().min(1),
});
export type CallSite = z.infer<typeof CallSiteSchema>;

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

export const BlockerSchema = z.object({
  summary: z.string().min(1),
  /** Verbatim quote is the whole point — a blocker without a quote is an opinion. */
  evidence: EvidenceSchema,
});
export type Blocker = z.infer<typeof BlockerSchema>;

export const ObservabilityGapSchema = z.object({
  deficiency: z.string().min(1),
  evidence: EvidenceSchema,
  recommended_instrumentation: z.string().min(1),
  /**
   * D18: the agent must assert the recommendation does not log minimized
   * fields (ssn / the v3-removed surfaces). A missing assertion fails schema.
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
 * Research-agent output: the full spec minus `downstream_impacts`.
 * Human-impact owns that object; splicing it in is the orchestrator's job (D23).
 */
export const ResearchSpecSchema = z.object({
  repo: z.string().min(1),
  verdict: VerdictSchema,
  call_sites: z.array(CallSiteSchema),
  persistence: z.array(PersistenceRecordSchema),
  required_changes: z.array(RequiredChangeSchema),
  test_impact: TestImpactSchema,
  blockers: z.array(BlockerSchema),
  production_verification: ProductionVerificationSchema,
  execution_grade: ExecutionGradeSchema,
  grade_reasoning: z.string().min(1),
  confidence: ConfidenceSchema,
  evidence: z.array(EvidenceSchema),
});
export type ResearchSpec = z.infer<typeof ResearchSpecSchema>;

/** Merged, gate-reviewed artifact. One of these per consumer repo. */
export const MigrationSpecSchema = ResearchSpecSchema.extend({
  downstream_impacts: DownstreamImpactsSchema,
});
export type MigrationSpec = z.infer<typeof MigrationSpecSchema>;
