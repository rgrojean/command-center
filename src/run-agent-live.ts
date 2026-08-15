import type { RunAgentOptions, RunAgentResult } from "./run-agent-types.ts";

/**
 * Live Cursor SDK path. Intentionally not imported until mode=live so a stub
 * run cannot accidentally construct an Agent. M1 wires Agent.create here
 * (local runtime, cwd = workspace clone). M0 refuses rather than no-op, so
 * a misplaced --live is loud.
 */
export async function runLiveAgent(_opts: RunAgentOptions): Promise<RunAgentResult> {
  throw new Error(
    "live mode is M1 — refusing to call @cursor/sdk. Re-run with --stub.",
  );
}
