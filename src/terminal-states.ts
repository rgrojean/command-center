/**
 * Closed set of pipeline terminals (D16). One module so the dashboard, the
 * manifest, and reset.sh cannot invent a sixth state.
 */
export const TERMINAL_STATES = [
  "migrated_verified",
  "migrated_with_flags",
  "blocked",
  "failed",
  "unaffected",
] as const;

export type TerminalState = (typeof TERMINAL_STATES)[number];

export const PIPELINE_STAGES = [
  "diff",
  "research",
  "human_impact",
  "merge",
  "validate",
  "hygiene",
  "gate",
  "write",
  "escalate_write",
  "fake_pr",
  "pr",
  "escalation_artifact",
  "report",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];
