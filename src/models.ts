import type { ExecutionGrade } from "./spec-schema.ts";

/**
 * D20 model routing. IDs from Cursor.models.list() on this account (2026-08-16).
 * Stub still records the placeholder names; live write uses LIVE_WRITE_MODELS.
 */
export const MODEL_PLACEHOLDERS = {
  frontier: "PLACEHOLDER_FRONTIER",
  mid: "PLACEHOLDER_MID",
  cheap: "PLACEHOLDER_CHEAP",
} as const;

export type ModelPlaceholder =
  (typeof MODEL_PLACEHOLDERS)[keyof typeof MODEL_PLACEHOLDERS];

/** Live LEGOLAS (research). Frontier slot — grok-4.6. */
export const LIVE_RESEARCH_MODEL = "grok-4.6";

/** Live BILBO (human-impact). Same proven local-runtime id as before the LEGOLAS split. */
export const LIVE_HUMAN_IMPACT_MODEL = "composer-2.5";

/**
 * Live write-agent ids. Cheap / mid / frontier from the account catalog.
 * Outer D25 escalate climbs LIVE_WRITE_ESCALATE, not the placeholder names.
 */
export const LIVE_WRITE_MODELS = {
  mechanical: "composer-2",
  contextual: "composer-2.5",
  judgment_heavy: "grok-4.6",
} as const satisfies Record<ExecutionGrade, string>;

export const LIVE_WRITE_ESCALATE = [
  LIVE_WRITE_MODELS.mechanical,
  LIVE_WRITE_MODELS.contextual,
  LIVE_WRITE_MODELS.judgment_heavy,
] as const;

export const MODEL_ROUTING = {
  /** Stub labels. Live IDs are LIVE_RESEARCH_MODEL / LIVE_HUMAN_IMPACT_MODEL. */
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

export function researchModelFor(mode: "live" | "stub"): string {
  return mode === "live" ? LIVE_RESEARCH_MODEL : MODEL_ROUTING.research;
}

export function humanImpactModelFor(mode: "live" | "stub"): string {
  return mode === "live" ? LIVE_HUMAN_IMPACT_MODEL : MODEL_ROUTING.human_impact;
}

export function writeModelsFor(mode: "live" | "stub"): Record<ExecutionGrade, string> {
  return mode === "live" ? LIVE_WRITE_MODELS : MODEL_ROUTING.write;
}

export function writeModelForGrade(grade: ExecutionGrade, mode: "live" | "stub" = "stub"): string {
  return mode === "live" ? LIVE_WRITE_MODELS[grade] : MODEL_ROUTING.write[grade];
}

export function nextModelTier(current: string, mode: "live" | "stub" = "stub"): string | undefined {
  const order =
    mode === "live" ? LIVE_WRITE_ESCALATE : MODEL_ROUTING.escalate_order;
  const idx = (order as readonly string[]).indexOf(current);
  if (idx < 0) return undefined;
  return order[idx + 1];
}
