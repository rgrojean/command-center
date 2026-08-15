import { runLiveAgent } from "./run-agent-live.ts";
import { runStubAgent } from "./run-agent-stub.ts";
import type { RunAgentOptions, RunAgentResult } from "./run-agent-types.ts";

export type { AgentKind, AgentMode, RunAgentOptions, RunAgentResult } from "./run-agent-types.ts";

export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  if (opts.mode === "stub") return runStubAgent(opts);
  return runLiveAgent(opts);
}
