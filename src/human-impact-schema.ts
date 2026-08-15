import { z } from "zod";
import { EvidenceSchema } from "./evidence.ts";

/**
 * Human-impact agent output. By D23 this object IS `spec.downstream_impacts`
 * after a deterministic splice — keep the two schemas identical by sharing
 * this module rather than copying fields.
 */
export const HumanImpactRatingSchema = z.enum(["HIGH", "MED", "LOW"]);
export type HumanImpactRating = z.infer<typeof HumanImpactRatingSchema>;

export const HumanFindingKindSchema = z.enum([
  "ui",
  "report_export",
  "documented_workflow",
]);

export const HumanFindingSchema = z.object({
  kind: HumanFindingKindSchema,
  summary: z.string().min(1),
  /** Verbatim quote + path required; no quote → hypothesized_consumers, not findings. */
  evidence: EvidenceSchema,
  rating: HumanImpactRatingSchema,
});
export type HumanFinding = z.infer<typeof HumanFindingSchema>;

export const HypothesizedConsumerSchema = z.object({
  hypothesis: z.string().min(1),
  evidence_trail: z.string().min(1),
  /** What a human reviewer should check to confirm or kill the hypothesis. */
  confirm_by: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type HypothesizedConsumer = z.infer<typeof HypothesizedConsumerSchema>;

export const DownstreamFlagKindSchema = z.enum([
  "uat_regression",
  "training",
  "comms",
]);

export const DownstreamFlagSchema = z.object({
  kind: DownstreamFlagKindSchema,
  summary: z.string().min(1),
  /**
   * Must equal some `findings[].summary`. Flags that cannot name a finding
   * are how "retrain the clerks" shows up with no evidence trail.
   */
  tied_to_finding: z.string().min(1),
});
export type DownstreamFlag = z.infer<typeof DownstreamFlagSchema>;

export const DownstreamImpactsSchema = z
  .object({
    findings: z.array(HumanFindingSchema),
    hypothesized_consumers: z.array(HypothesizedConsumerSchema),
    flags: z.array(DownstreamFlagSchema),
    overall_rating: HumanImpactRatingSchema,
    rating_rationale: z.string().min(1),
    rating_would_change_if: z.string().min(1),
  })
  .superRefine((value, ctx) => {
    const summaries = new Set(value.findings.map((f) => f.summary));
    for (const [i, flag] of value.flags.entries()) {
      if (!summaries.has(flag.tied_to_finding)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "downstream flag must tie to an actual finding summary (D17)",
          path: ["flags", i, "tied_to_finding"],
        });
      }
    }
  });
export type DownstreamImpacts = z.infer<typeof DownstreamImpactsSchema>;

/** Alias so prompt injection and spec.downstream_impacts cannot drift. */
export const HumanImpactSchema = DownstreamImpactsSchema;
export type HumanImpact = DownstreamImpacts;
