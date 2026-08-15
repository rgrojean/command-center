import { BreakingFieldSchema } from "./evidence.ts";

/**
 * M0: canned three-change summary. M1 replaces this with a deterministic
 * OpenAPI structural diff of PIS v2 (in the identity repo) vs
 * specs/pis-openapi-v3.yaml. Do not grow this list — v3 is exactly three breaks.
 */
export const PIS_V3_CHANGES = [
  {
    field: BreakingFieldSchema.enum.ssn,
    from: "required string",
    to: "removed",
  },
  {
    field: BreakingFieldSchema.enum.name,
    from: 'flat display string (e.g. "Garcia, Maria")',
    to: "given[] / family",
  },
  {
    field: BreakingFieldSchema.enum.patientId,
    from: "string path/body identifier",
    to: "identifier[] { system, value }",
  },
] as const;

export type DiffResult = {
  changes: typeof PIS_V3_CHANGES;
  summary: string;
};

export function diffPisV2V3(): DiffResult {
  const summary = [
    "PIS v3 breaking changes (exactly three; everything else survives):",
    "1. `ssn` is removed.",
    "2. `name` (flat string) becomes `given` (string array) and `family` (string).",
    "3. `patientId` (string) becomes `identifier` (list of `{system, value}`).",
  ].join("\n");
  return { changes: PIS_V3_CHANGES, summary };
}
