import {
  LIVE_HUMAN_IMPACT_MODEL,
  LIVE_RESEARCH_MODEL,
  MODEL_ROUTING,
  writeModelForGrade,
} from "./models.ts";
import { runAgent, type AgentMode, type RunAgentResult } from "./run-agent.ts";
import type { AgentEvent } from "./run-agent-types.ts";
import type { ExecutionGrade } from "./spec-schema.ts";

export type CallSiteOpts = {
  repo: string;
  workspace: string;
  prompt: string;
  mode: AgentMode;
  githubUrl?: string;
  startingRef?: string;
  autoCreatePR?: boolean;
  onEvent?: (event: AgentEvent) => void;
  signal?: AbortSignal;
  registerCancel?: (cancel: () => void) => () => void;
};

/**
 * Call site 1 — research and human-impact share this. Both inspect a clone
 * the orchestrator restored to baseline-v2; they differ only by prompt and
 * the stub fixture `kind`. They may run tests; they must not edit tracked source.
 */
export function runReadOnlyAgent(
  opts: CallSiteOpts & { kind: "research" | "human-impact" },
): Promise<RunAgentResult> {
  const model =
    opts.mode === "live"
      ? opts.kind === "research"
        ? LIVE_RESEARCH_MODEL
        : LIVE_HUMAN_IMPACT_MODEL
      : opts.kind === "research"
        ? MODEL_ROUTING.research
        : MODEL_ROUTING.human_impact;
  return runAgent({
    repo: opts.repo,
    workspace: opts.workspace,
    prompt: opts.prompt,
    model,
    mode: opts.mode,
    kind: opts.kind,
    githubUrl: opts.githubUrl,
    startingRef: opts.startingRef,
    autoCreatePR: opts.autoCreatePR,
    onEvent: opts.onEvent,
    signal: opts.signal,
    registerCancel: opts.registerCancel,
  });
}

/**
 * Call site 2 — write agent. Spec-bound execution on branch migration/spec-v3.
 * Model comes from D20 grade routing (or an escalated tier on retry).
 */
export function runWriteAgent(
  opts: CallSiteOpts & { grade: ExecutionGrade; modelOverride?: string },
): Promise<RunAgentResult> {
  return runAgent({
    repo: opts.repo,
    workspace: opts.workspace,
    prompt: opts.prompt,
    model: opts.modelOverride ?? writeModelForGrade(opts.grade, opts.mode),
    mode: opts.mode,
    kind: "write",
    githubUrl: opts.githubUrl,
    startingRef: opts.startingRef,
    autoCreatePR: opts.autoCreatePR,
    onEvent: opts.onEvent,
    signal: opts.signal,
    registerCancel: opts.registerCancel,
  });
}
