import type { ExecutionGrade } from "./spec-schema.js";

export type HttpDecision = {
  decision: "approved" | "rejected";
  note?: string;
  grade_override?: ExecutionGrade;
  model_override?: string;
  at: string;
};

export class PipelineKilled extends Error {
  readonly code = "KILLED";
  constructor(reason = "killed from dashboard") {
    super(reason);
    this.name = "PipelineKilled";
  }
}

export function isPipelineKilled(err: unknown): boolean {
  return err instanceof PipelineKilled;
}

/**
 * In-memory waiters for one HTTP-driven run. Disk (`decision.json`, manifest)
 * is the source of truth the UI polls; this object is only the control plane
 * that unblocks `runPipeline`.
 */
export function createHttpHold(): HttpHold {
  const pending = new Map<
    string,
    {
      promise: Promise<HttpDecision>;
      resolve: (d: HttpDecision) => void;
      reject: (err: Error) => void;
    }
  >();
  let releaseResolve: () => void = () => {};
  let releaseReject: (err: Error) => void = () => {};
  const released = new Promise<void>((resolve, reject) => {
    releaseResolve = resolve;
    releaseReject = reject;
  });
  released.catch(() => {
    /* abort may reject before waitForRelease is awaited */
  });
  let didRelease = false;
  let aborted: Error | undefined;
  const controller = new AbortController();
  const cancels = new Set<() => void>();

  function waiter(slug: string) {
    const existing = pending.get(slug);
    if (existing) return existing;
    let resolve!: (d: HttpDecision) => void;
    let reject!: (err: Error) => void;
    const promise = new Promise<HttpDecision>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const entry = { promise, resolve, reject };
    pending.set(slug, entry);
    return entry;
  }

  return {
    waitForDecision(slug: string, already?: HttpDecision): Promise<HttpDecision> {
      if (aborted) return Promise.reject(aborted);
      if (already) return Promise.resolve(already);
      return waiter(slug).promise;
    },
    waitForRelease(): Promise<void> {
      if (aborted) return Promise.reject(aborted);
      if (didRelease) return Promise.resolve();
      return released;
    },
    record(slug: string, decision: HttpDecision): void {
      if (aborted) throw aborted;
      waiter(slug).resolve(decision);
    },
    release(): void {
      if (aborted) throw aborted;
      if (didRelease) return;
      didRelease = true;
      releaseResolve();
    },
    abort(reason: string): void {
      if (aborted) return;
      aborted = new PipelineKilled(reason);
      controller.abort();
      for (const cancel of [...cancels]) {
        try {
          cancel();
        } catch {
          /* cancel is best-effort; the agent loop still unwinds */
        }
      }
      for (const w of pending.values()) w.reject(aborted);
      if (!didRelease) releaseReject(aborted);
    },
    registerCancel(cancel: () => void): () => void {
      cancels.add(cancel);
      return () => {
        cancels.delete(cancel);
      };
    },
    get signal(): AbortSignal {
      return controller.signal;
    },
    get aborted(): Error | undefined {
      return aborted;
    },
    get didRelease(): boolean {
      return didRelease;
    },
  };
}

export type HttpHold = {
  waitForDecision: (slug: string, already?: HttpDecision) => Promise<HttpDecision>;
  waitForRelease: () => Promise<void>;
  record: (slug: string, decision: HttpDecision) => void;
  release: () => void;
  abort: (reason: string) => void;
  registerCancel: (cancel: () => void) => () => void;
  readonly signal: AbortSignal;
  readonly aborted: Error | undefined;
  readonly didRelease: boolean;
};
