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

/** D30 — enum members come from the diff, not a hardcoded list. */
export function breakingFieldEnum(fields: string[]) {
  const unique = [...new Set(fields)];
  if (unique.length < 1) {
    throw new Error("breakingFieldEnum requires at least one field from the diff");
  }
  return z.enum(unique as [string, ...string[]]);
}

export type BreakingField = string;
