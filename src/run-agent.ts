import { runLiveAgent } from "./run-agent-live.js";
import { runStubAgent } from "./run-agent-stub.js";
import type { RunAgentOptions, RunAgentResult } from "./run-agent-types.js";

export type { AgentKind, AgentMode, RunAgentOptions, RunAgentResult } from "./run-agent-types.js";

export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  if (opts.mode === "stub") return runStubAgent(opts);
  return runLiveAgent(opts);
}
