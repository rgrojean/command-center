import { MODEL_ROUTING, writeModelForGrade } from "./models.ts";
import { runAgent, type AgentMode, type RunAgentResult } from "./run-agent.ts";
import type { ExecutionGrade } from "./spec-schema.ts";

export type CallSiteOpts = {
  repo: string;
  workspace: string;
  prompt: string;
  mode: AgentMode;
};

/**
 * Call site 1 — research and human-impact share this. Both are read-only
 * against a clone; they differ only by prompt and the stub fixture `kind`.
 */
export function runReadOnlyAgent(
  opts: CallSiteOpts & { kind: "research" | "human-impact" },
): Promise<RunAgentResult> {
  const model =
    opts.kind === "research" ? MODEL_ROUTING.research : MODEL_ROUTING.human_impact;
  return runAgent({
    repo: opts.repo,
    workspace: opts.workspace,
    prompt: opts.prompt,
    model,
    mode: opts.mode,
    kind: opts.kind,
  });
}

/**
 * Call site 2 — write agent. Spec-bound execution on branch migration/pis-v3.
 * Model comes from D20 grade routing (or an escalated tier on retry).
 */
export function runWriteAgent(
  opts: CallSiteOpts & { grade: ExecutionGrade; modelOverride?: string },
): Promise<RunAgentResult> {
  return runAgent({
    repo: opts.repo,
    workspace: opts.workspace,
    prompt: opts.prompt,
    model: opts.modelOverride ?? writeModelForGrade(opts.grade),
    mode: opts.mode,
    kind: "write",
  });
}
