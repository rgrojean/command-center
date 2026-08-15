export type AgentKind = "research" | "human-impact" | "write";
export type AgentMode = "live" | "stub";

/**
 * The one SDK seam. Two call sites (read-only vs write) both land here.
 * `kind` is not in the session-brief signature; it exists so stub fixtures
 * and live logging can tell the three agent roles apart without parsing
 * prompt text. `workspace` is the clone path (empty string in M0 stub —
 * we do not clone until M1).
 */
export type RunAgentOptions = {
  repo: string;
  workspace: string;
  prompt: string;
  model: string;
  mode: AgentMode;
  kind: AgentKind;
};

export type AgentEvent = {
  type: string;
  text?: string;
  data?: unknown;
};

export type RunAgentResult = {
  events: AgentEvent[];
  result: unknown;
};
