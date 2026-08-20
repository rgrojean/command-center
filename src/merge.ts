import type { DownstreamImpacts } from "./human-impact-schema.js";
import type { MigrationSpec, ResearchSpec } from "./spec-schema.js";

/**
 * D23 — deterministic splice, disjoint ownership, no third LLM pass.
 * Research owns verdict / required_changes / execution_grade.
 * Human-impact owns the entire downstream_impacts object, including HIGH/MED/LOW.
 * Findings never mechanically alter the verdict; the gate renders both.
 * Validation against the diff-derived schema is the orchestrator's job (D30).
 */
export function mergeResearchAndHumanImpact(
  research: ResearchSpec,
  humanImpact: DownstreamImpacts,
): MigrationSpec {
  return { ...research, downstream_impacts: humanImpact };
}
