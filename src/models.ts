import type { ExecutionGrade } from "./spec-schema.ts";

/**
 * D20 model routing. IDs stay placeholders until M2 — fill from the account
 * quickstart, not from guesses. The pipeline already threads `model` through
 * `runAgent`, so swapping strings here is the whole live-mode change.
 */
export const MODEL_PLACEHOLDERS = {
  frontier: "PLACEHOLDER_FRONTIER",
  mid: "PLACEHOLDER_MID",
  cheap: "PLACEHOLDER_CHEAP",
} as const;

export type ModelPlaceholder =
  (typeof MODEL_PLACEHOLDERS)[keyof typeof MODEL_PLACEHOLDERS];

export const MODEL_ROUTING = {
  /** Research + human-impact share the frontier slot (read-only, judgment-heavy). */
  research: MODEL_PLACEHOLDERS.frontier,
  human_impact: MODEL_PLACEHOLDERS.frontier,
  write: {
    mechanical: MODEL_PLACEHOLDERS.cheap,
    contextual: MODEL_PLACEHOLDERS.mid,
    judgment_heavy: MODEL_PLACEHOLDERS.frontier,
  } satisfies Record<ExecutionGrade, ModelPlaceholder>,
  /**
   * Orchestrator-level escalation climbs this list one step (D25).
   * Inner test-fix retries do not move the pointer.
   */
  escalate_order: [
    MODEL_PLACEHOLDERS.cheap,
    MODEL_PLACEHOLDERS.mid,
    MODEL_PLACEHOLDERS.frontier,
  ] as const,
};

export function writeModelForGrade(grade: ExecutionGrade): ModelPlaceholder {
  return MODEL_ROUTING.write[grade];
}

export function nextModelTier(current: string): ModelPlaceholder | undefined {
  const order = MODEL_ROUTING.escalate_order;
  const idx = order.indexOf(current as ModelPlaceholder);
  if (idx < 0) return order[order.length - 1];
  return order[idx + 1];
}
