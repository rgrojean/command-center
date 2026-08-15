import type { DownstreamImpacts } from "./human-impact-schema.ts";
import {
  MigrationSpecSchema,
  type MigrationSpec,
  type ResearchSpec,
} from "./spec-schema.ts";

/**
 * D23 — deterministic splice, disjoint ownership, no third LLM pass.
 * Research owns verdict / required_changes / execution_grade.
 * Human-impact owns the entire downstream_impacts object, including HIGH/MED/LOW.
 * Findings never mechanically alter the verdict; the gate renders both.
 */
export function mergeResearchAndHumanImpact(
  research: ResearchSpec,
  humanImpact: DownstreamImpacts,
): MigrationSpec {
  if (research.verdict === "blocked" && research.blockers.length === 0) {
    throw new Error(
      `${research.repo}: verdict=blocked requires at least one quoted blocker`,
    );
  }
  return MigrationSpecSchema.parse({
    ...research,
    downstream_impacts: humanImpact,
  });
}
