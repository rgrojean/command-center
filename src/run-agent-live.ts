import { Agent, CursorAgentError } from "@cursor/sdk";
import { CapacityError, isCapacityError } from "./concurrency.js";
import { cursorApiKey } from "./cursor-auth.js";
import { cloudStartingRef } from "./github-ref.js";
import { PipelineKilled } from "./hold.js";
import { extractJson } from "./json-extract.js";
import type { RunAgentOptions, RunAgentResult, AgentEvent } from "./run-agent-types.js";
import { useCloudAgents } from "./runtime.js";

/** No stream event for this long → cancel and retry once (D34). */
export const STREAM_IDLE_MS = 90_000;

export class IdleTimeoutError extends Error {
  readonly code = "STREAM_IDLE";
  constructor(idleMs: number) {
    super(`agent stream idle for ${idleMs}ms`);
    this.name = "IdleTimeoutError";
  }
}

function textOf(event: {
  type: string;
  text?: string;
  message?: { content?: Array<{ type: string; text?: string }> };
}): string | undefined {
  if (event.type === "assistant") {
    const message = event.message as
      | { content?: Array<{ type: string; text?: string }> }
      | undefined;
    return message?.content
      ?.filter((b) => b.type === "text" && b.text)
      .map((b) => b.text)
      .join("");
  }
  if (event.type === "thinking" && typeof event.text === "string") return event.text;
  return undefined;
}

function throwIfKilled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new PipelineKilled();
}

function tryCancel(run: { supports: (op: "cancel") => boolean; cancel: () => unknown }): void {
  if (run.supports("cancel")) void run.cancel();
}

async function* iterateWithIdle<T>(
  source: AsyncIterable<T>,
  idleMs: number,
): AsyncGenerator<T> {
  const it = source[Symbol.asyncIterator]();
  while (true) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new IdleTimeoutError(idleMs)), idleMs);
    });
    try {
      const result = await Promise.race([it.next(), timeout]);
      if (result.done) return;
      yield result.value;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/**
 * Live Cursor agent: local cwd against a clone, or cloud against github_url
 * when hosted (Vercel has no local executor).
 */
export async function runLiveAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const cloud = useCloudAgents();
  if (cloud && !opts.githubUrl) {
    throw new Error(`live ${opts.kind} for ${opts.repo} needs githubUrl on cloud runtime`);
  }
  if (!cloud && !opts.workspace) {
    throw new Error(`live ${opts.kind} for ${opts.repo} needs a workspace clone`);
  }
  const events: AgentEvent[] = [];
  const emit = (event: AgentEvent) => {
    events.push(event);
    opts.onEvent?.(event);
  };

  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      return await runLiveAttempt(opts, emit, events);
    } catch (err) {
      if (err instanceof IdleTimeoutError && attempt < 2) {
        emit({ type: "stream_idle_retry", text: err.message });
        continue;
      }
      if (err instanceof PipelineKilled) throw err;
      if (opts.signal?.aborted) throw new PipelineKilled();
      if (err instanceof CapacityError) throw err;
      if (err instanceof CursorAgentError) {
        const msg = `SDK startup failed (retryable=${err.isRetryable}): ${err.message}`;
        if (isCapacityError(err)) {
          throw new CapacityError(msg, err);
        }
        throw new Error(msg, { cause: err });
      }
      if (isCapacityError(err)) {
        throw new CapacityError(err instanceof Error ? err.message : String(err), err);
      }
      throw err;
    }
  }
}

async function runLiveAttempt(
  opts: RunAgentOptions,
  emit: (event: AgentEvent) => void,
  events: AgentEvent[],
): Promise<RunAgentResult> {
  const apiKey = cursorApiKey();
  throwIfKilled(opts.signal);
  const cloud = useCloudAgents();
  const startingRef = cloud
    ? await cloudStartingRef(opts.githubUrl, opts.startingRef)
    : opts.startingRef;
  if (cloud && !startingRef) {
    throw new Error(`live ${opts.kind} for ${opts.repo} needs startingRef on cloud runtime`);
  }
  if (cloud && startingRef && startingRef !== opts.startingRef) {
    emit({
      type: "starting_ref",
      text: `cloud startingRef ${opts.startingRef} → ${startingRef}`,
    });
  }
  const agent = await Agent.create({
    ...(apiKey ? { apiKey } : {}),
    model: { id: opts.model },
    ...(cloud
      ? {
          cloud: {
            repos: [
              {
                url: opts.githubUrl!,
                startingRef,
              },
            ],
            autoCreatePR: opts.kind === "write" && opts.autoCreatePR === true,
            skipReviewerRequest: true,
          },
        }
      : { local: { cwd: opts.workspace, settingSources: [] as const } }),
  });
  try {
    throwIfKilled(opts.signal);
    const run = await agent.send(opts.prompt);
    throwIfKilled(opts.signal);
    const cancel = () => tryCancel(run);
    const unregister = opts.registerCancel?.(cancel);
    opts.signal?.addEventListener("abort", cancel, { once: true });
    emit({
      type: "run_started",
      text: `agent=${run.agentId} run=${run.id} model=${opts.model}`,
      data: { agentId: run.agentId, runId: run.id, attempt: events.filter((e) => e.type === "run_started").length + 1 },
    });

    let streamed = "";
    try {
      try {
        for await (const event of iterateWithIdle(run.stream(), STREAM_IDLE_MS)) {
          throwIfKilled(opts.signal);
          if (event.type === "assistant") {
            const chunk = textOf(event as Parameters<typeof textOf>[0]) ?? "";
            streamed += chunk;
            if (chunk) emit({ type: "assistant", text: chunk });
          } else if (event.type === "tool_call") {
            emit({
              type: "tool_call",
              text: `${event.name} ${event.status}`,
              data: { name: event.name, status: event.status, call_id: event.call_id },
            });
          }
        }
      } catch (err) {
        if (err instanceof IdleTimeoutError) {
          tryCancel(run);
          emit({ type: "stream_idle", text: err.message });
          throw err;
        }
        throw err;
      }

      const waited = await run.wait();
      if (opts.signal?.aborted || waited.status === "cancelled") {
        emit({ type: "killed", text: "killed from dashboard" });
        throw new PipelineKilled();
      }
      if (waited.status === "error") {
        const errObj = waited.error;
        const detail =
          errObj && typeof errObj === "object" && "message" in errObj
            ? String((errObj as { message: unknown }).message)
            : String(errObj ?? "unknown");
        const msg = `run ${waited.id} status=error: ${detail}`;
        if (isCapacityError(errObj) || isCapacityError(new Error(detail))) {
          throw new CapacityError(msg, errObj);
        }
        throw new Error(msg);
      }
      const raw = waited.result ?? streamed;
      const result = extractJson(raw);
      emit({ type: "run_finished", text: waited.status, data: { id: waited.id } });
      return { events, result };
    } finally {
      opts.signal?.removeEventListener("abort", cancel);
      unregister?.();
    }
  } finally {
    await agent[Symbol.asyncDispose]();
  }
}
