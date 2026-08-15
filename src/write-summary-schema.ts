import { z } from "zod";

/**
 * Write-agent terminal output. The prompt used to ask for prose; the
 * orchestrator needs a structured object to build PR bodies and to decide
 * whether the inner test-fix loop actually got to green.
 */
export const WriteSummarySchema = z.object({
  repo: z.string().min(1),
  files_changed: z.array(
    z.object({
      path: z.string().min(1),
      action: z.enum(["created", "modified", "deleted"]),
      summary: z.string().min(1),
    }),
  ),
  test_runs: z.array(
    z.object({
      attempt: z.number().int().positive(),
      failures: z.array(z.string()),
      resolution: z.string().min(1),
    }),
  ),
  judgment_calls: z.array(
    z.object({
      what: z.string().min(1),
      why: z.string().min(1),
      /** Required when blessing a fixture/golden regen — show the diff you accepted. */
      diff_verified: z.string().optional(),
    }),
  ),
  incomplete: z.array(
    z.object({
      spec_item: z.string().min(1),
      why: z.string().min(1),
    }),
  ),
  human_impact_notes: z.array(
    z.object({
      finding: z.string().min(1),
      note: z.string().min(1),
    }),
  ),
});
export type WriteSummary = z.infer<typeof WriteSummarySchema>;

/** Inner loop exhausted or leftover spec items → orchestrator may escalate a tier (D25). */
export function writeRunFailed(summary: WriteSummary): boolean {
  if (summary.incomplete.length > 0) return true;
  const last = summary.test_runs[summary.test_runs.length - 1];
  return Boolean(last && last.failures.length > 0);
}
