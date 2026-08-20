import type { TerminalState } from "./terminal-states.js";

export type TransitionEvent = {
  runId: string;
  repo: string;
  from: string;
  to: TerminalState | string;
  at: string;
};

/**
 * Soft seam. Default is silence — a later milestone can page Slack / a
 * dashboard watcher without touching the pipeline body.
 */
export function notify(_event: TransitionEvent): void {
  // no-op by design
}
