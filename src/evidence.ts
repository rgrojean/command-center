import { z } from "zod";

/**
 * Every claim-bearing field in the spec schemas carries one of these.
 * `line` is optional because some evidence lives in YAML/SQL/docs where a
 * quote is stronger than a line number that will drift. `quote` is required
 * so "I saw it in the README" cannot be a citation-free claim.
 */
export const EvidenceSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive().optional(),
  quote: z.string().min(1),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/** The only three PIS v3 breaks. Everything else surviving is out of scope. */
export const BreakingFieldSchema = z.enum(["ssn", "name", "patientId"]);
export type BreakingField = z.infer<typeof BreakingFieldSchema>;
