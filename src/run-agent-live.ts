import { Agent, CursorAgentError } from "@cursor/sdk";
import { CapacityError, isCapacityError } from "./concurrency.js";
import { cursorApiKey } from "./cursor-auth.js";
import { cloudStartingRef } from "./github-ref.js";
import { PipelineKilled } from "./hold.js";
import { extractJson } from "./json-extract.js";
import type { AgentEvent, RunAgentOptions, RunAgentResult } from "./run-agent-types.js";
import { isolateHeadroomMs, isolateRemainingMs, useCloudAgents } from "./runtime.js";
import { trackCloudRun, untrackCloudRun } from "./cloud-handles.js";

/** No stream event for this long → treat the SSE as dead and poll the run. */
export const STREAM_IDLE_MS = 40_000;
const CREATE_MS = 60_000;
const SEND_MS = 60_000;
/** `run.wait()` after the stream ends — must not hang the isolate. */
const WAIT_MS = 15_000;
/** wait() blocks until terminal; timeout means still running, not "use the leftover tokens". */
const POLL_WAIT_MS = 30_000;
const POLL_SLEEP_MS = 10_000;
const POLL_EMIT_MS = 45_000;
const RESEARCH_POLL_MS = 180_000;
const WRITE_POLL_MS = 480_000;

export class IdleTimeoutError extends Error {
  readonly code = "STREAM_IDLE";
  constructor(idleMs: number) {
    super(`agent stream idle for ${idleMs}ms`);
    this.name = "IdleTimeoutError";
  }
}

type Waited = {
  id: string;
  status: string;
  result?: string;
  error?: unknown;
};

type SdkRun = {
  id: string;
  agentId: string;
  stream: () => AsyncIterable<unknown>;
  wait: () => Promise<Waited>;
  supports: (op: "cancel") => boolean;
  cancel: () => unknown;
};

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

function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new PipelineKilled());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new PipelineKilled());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

function rememberCloudRun(opts: RunAgentOptions, run: SdkRun): void {
  if (!opts.pipelineRunId || !useCloudAgents()) return;
  trackCloudRun(opts.pipelineRunId, {
    repo: opts.repo,
    kind: opts.kind,
    agentId: run.agentId,
    runId: run.id,
  });
}

function forgetCloudRun(opts: RunAgentOptions, run: SdkRun): void {
  if (!opts.pipelineRunId) return;
  untrackCloudRun(opts.pipelineRunId, run.id);
}

function tryCancel(run: SdkRun): void {
  if (run.supports("cancel")) void run.cancel();
}

function detailOf(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  if (err instanceof Error) return err.message;
  return String(err ?? "");
}

function isStreamGone(err: unknown): boolean {
  return /stream is no longer available|stream_expired|stream expired|\b410\b/i.test(detailOf(err));
}

function isTimeout(err: unknown): boolean {
  return /timed out after/i.test(detailOf(err));
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  throwIfKilled(signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await raceAbort(
      Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        }),
      ]),
      signal,
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new PipelineKilled());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new PipelineKilled());
      },
      { once: true },
    );
  });
}

async function* iterateWithIdle<T>(
  source: AsyncIterable<T>,
  idleMs: number,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  const it = source[Symbol.asyncIterator]();
  while (true) {
    throwIfKilled(signal);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new IdleTimeoutError(idleMs)), idleMs);
    });
    try {
      const result = await raceAbort(Promise.race([it.next(), timeout]), signal);
      if (result.done) return;
      yield result.value;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

async function cloudHandle(run: SdkRun): Promise<SdkRun> {
  const apiKey = cursorApiKey();
  return (await Agent.getRun(run.id, {
    runtime: "cloud",
    agentId: run.agentId,
    ...(apiKey ? { apiKey } : {}),
  })) as unknown as SdkRun;
}

async function waitOnce(run: SdkRun, ms: number, signal?: AbortSignal): Promise<Waited> {
  return withTimeout(run.wait(), ms, "run.wait", signal);
}

function waitedErrorMessage(waited: Waited): string {
  return `run ${waited.id} status=error: ${detailOf(waited.error)}`;
}

function isWaitedStreamGone(waited: Waited): boolean {
  return waited.status === "error" && isStreamGone(waited.error);
}

function pollBudgetMs(kind: RunAgentOptions["kind"]): number {
  const remaining = isolateRemainingMs() - isolateHeadroomMs();
  const cap = kind === "write" ? WRITE_POLL_MS : RESEARCH_POLL_MS;
  return Math.max(0, Math.min(cap, remaining));
}

function elapsedLabel(started: number): string {
  const s = Math.max(0, Math.round((Date.now() - started) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

async function pollCloudRun(
  run: SdkRun,
  streamed: string,
  emit: (event: AgentEvent) => void,
  opts: RunAgentOptions,
): Promise<Waited> {
  const budget = pollBudgetMs(opts.kind);
  if (budget < 15_000) {
    throw new Error("host time budget exhausted while waiting on cloud run");
  }
  const started = Date.now();
  let lastEmit = 0;
  const note = (text: string) => {
    const now = Date.now();
    if (lastEmit !== 0 && now - lastEmit < POLL_EMIT_MS) return;
    lastEmit = now;
    emit({ type: "run_poll", text, data: { runId: run.id, agentId: run.agentId } });
  };
  note("watching cloud run (live stream lost)");

  while (Date.now() - started < budget) {
    throwIfKilled(opts.signal);
    if (isolateRemainingMs() < isolateHeadroomMs()) {
      throw new Error("host time budget exhausted while waiting on cloud run");
    }
    try {
      const handle = await cloudHandle(run);
      const waited = await waitOnce(handle, POLL_WAIT_MS, opts.signal);
      if (isWaitedStreamGone(waited) || waited.status === "running") {
        note(`cloud run still going · ${elapsedLabel(started)}`);
        await sleep(POLL_SLEEP_MS, opts.signal);
        continue;
      }
      if (!waited.result && streamed.trim()) return { ...waited, result: streamed };
      return waited;
    } catch (err) {
      if (err instanceof PipelineKilled) throw err;
      if (isStreamGone(err) || isTimeout(err)) {
        note(`cloud run still going · ${elapsedLabel(started)}`);
        await sleep(POLL_SLEEP_MS, opts.signal);
        continue;
      }
      throw err;
    }
  }
  throw new Error("cloud run did not finish before host time budget");
}

async function finishRun(
  run: SdkRun,
  streamed: string,
  dropped: boolean,
  emit: (event: AgentEvent) => void,
  opts: RunAgentOptions,
): Promise<Waited> {
  if (!dropped) {
    try {
      const waited = await waitOnce(run, WAIT_MS, opts.signal);
      if (isWaitedStreamGone(waited)) {
        return pollCloudRun(run, streamed || waited.result || "", emit, opts);
      }
      if (!waited.result && streamed.trim()) return { ...waited, result: streamed };
      return waited;
    } catch (err) {
      if (err instanceof PipelineKilled) throw err;
      if (isStreamGone(err) || isTimeout(err)) {
        dropped = true;
      } else {
        throw err;
      }
    }
  }
  if (useCloudAgents()) {
    return pollCloudRun(run, streamed, emit, opts);
  }
  if (streamed.trim()) return { id: run.id, status: "finished", result: streamed };
  throw new Error(`run ${run.id} stream dropped with no output`);
}

async function watchRun(
  run: SdkRun,
  emit: (event: AgentEvent) => void,
  opts: RunAgentOptions,
): Promise<Waited> {
  let streamed = "";
  let dropped = false;
  try {
    for await (const event of iterateWithIdle(run.stream(), STREAM_IDLE_MS, opts.signal)) {
      throwIfKilled(opts.signal);
      const typed = event as Parameters<typeof textOf>[0] & {
        type: string;
        name?: string;
        status?: string;
        call_id?: string;
      };
      if (typed.type === "assistant") {
        const chunk = textOf(typed) ?? "";
        streamed += chunk;
        if (chunk) emit({ type: "assistant", text: chunk });
      } else if (typed.type === "tool_call") {
        emit({
          type: "tool_call",
          text: `${typed.name} ${typed.status}`,
          data: { name: typed.name, status: typed.status, call_id: typed.call_id },
        });
      } else if (typed.type === "status") {
        emit({
          type: "status",
          text: String((typed as { status?: string }).status ?? "running"),
        });
      }
    }
  } catch (err) {
    if (err instanceof PipelineKilled) {
      emit({ type: "killed", text: "killed from dashboard" });
      throw err;
    }
    if (err instanceof IdleTimeoutError || isStreamGone(err)) {
      dropped = true;
      emit({
        type: err instanceof IdleTimeoutError ? "stream_idle" : "stream_recover",
        text: detailOf(err),
      });
    } else {
      throw err;
    }
  }
  return finishRun(run, streamed, dropped, emit, opts);
}

function throwIfFailed(waited: Waited): void {
  if (waited.status === "cancelled") throw new PipelineKilled();
  if (waited.status === "error") {
    const msg = waitedErrorMessage(waited);
    if (isCapacityError(waited.error) || isCapacityError(new Error(detailOf(waited.error)))) {
      throw new CapacityError(msg, waited.error);
    }
    throw new Error(msg);
  }
}

async function parseOrRepair(
  agent: Awaited<ReturnType<typeof Agent.create>>,
  waited: Waited,
  emit: (event: AgentEvent) => void,
  opts: RunAgentOptions,
  events: AgentEvent[],
): Promise<unknown> {
  const raw = waited.result ?? "";
  try {
    return extractJson(raw);
  } catch (parseErr) {
    const why = parseErr instanceof Error ? parseErr.message : String(parseErr);
    emit({ type: "json_retry", text: why });
    throwIfKilled(opts.signal);
    const fix = (await withTimeout(
      agent.send(
        `Your previous output was not valid JSON (${why}). Return ONLY a corrected JSON object. No markdown fences, no prose before or after it.`,
      ),
      SEND_MS,
      "agent.send",
      opts.signal,
    )) as unknown as SdkRun;
    rememberCloudRun(opts, fix);
    emit({
      type: "run_started",
      text: `agent=${fix.agentId} run=${fix.id} model=${opts.model} json_retry`,
      data: { agentId: fix.agentId, runId: fix.id, attempt: events.filter((e) => e.type === "run_started").length + 1 },
    });
    const unregister = opts.registerCancel?.(() => tryCancel(fix));
    opts.signal?.addEventListener("abort", () => tryCancel(fix), { once: true });
    try {
      const fixed = await watchRun(fix, emit, opts);
      if (opts.signal?.aborted || fixed.status === "cancelled") throw new PipelineKilled();
      throwIfFailed(fixed);
      return extractJson(fixed.result ?? "");
    } finally {
      forgetCloudRun(opts, fix);
      unregister?.();
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
      if (err instanceof IdleTimeoutError && attempt < 2 && opts.kind !== "write") {
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
    ? await raceAbort(cloudStartingRef(opts.githubUrl, opts.startingRef), opts.signal)
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
  emit({
    type: "cloud_boot",
    text: cloud ? "starting cloud VM" : "starting local agent",
  });
  let agent: Awaited<ReturnType<typeof Agent.create>> | undefined;
  try {
    agent = await withTimeout(
      Agent.create({
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
      }).then((created) => {
        agent = created;
        return created;
      }),
      CREATE_MS,
      "Agent.create",
      opts.signal,
    );
  } catch (err) {
    if (agent) {
      try {
        await agent[Symbol.asyncDispose]();
      } catch {
        /* */
      }
    }
    throw err;
  }
  if (!agent) throw new Error("Agent.create returned no agent");
  const session = agent;
  try {
    throwIfKilled(opts.signal);
    emit({ type: "cloud_boot", text: "sending prompt" });
    const run = (await withTimeout(
      session.send(opts.prompt),
      SEND_MS,
      "agent.send",
      opts.signal,
    )) as unknown as SdkRun;
    throwIfKilled(opts.signal);
    rememberCloudRun(opts, run);
    const cancel = () => tryCancel(run);
    const unregister = opts.registerCancel?.(cancel);
    opts.signal?.addEventListener("abort", cancel, { once: true });
    emit({
      type: "run_started",
      text: `agent=${run.agentId} run=${run.id} model=${opts.model}`,
      data: { agentId: run.agentId, runId: run.id, attempt: events.filter((e) => e.type === "run_started").length + 1 },
    });

    try {
      const waited = await watchRun(run, emit, opts);
      if (opts.signal?.aborted || waited.status === "cancelled") {
        emit({ type: "killed", text: "killed from dashboard" });
        throw new PipelineKilled();
      }
      throwIfFailed(waited);
      const result = await parseOrRepair(session, waited, emit, opts, events);
      emit({ type: "run_finished", text: waited.status, data: { id: waited.id } });
      return { events, result };
    } finally {
      forgetCloudRun(opts, run);
      opts.signal?.removeEventListener("abort", cancel);
      unregister?.();
    }
  } finally {
    await session[Symbol.asyncDispose]();
  }
}
