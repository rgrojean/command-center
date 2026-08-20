/** Hosted vs local execution. Vercel cannot run local Cursor executors. */

export function isVercel(): boolean {
  return Boolean(process.env.VERCEL);
}

/** Cloud agents when hosted, or when CURSOR_RUNTIME=cloud. */
export function useCloudAgents(): boolean {
  if (process.env.CURSOR_RUNTIME === "local") return false;
  if (process.env.CURSOR_RUNTIME === "cloud") return true;
  return isVercel();
}

/** Real GitHub PRs from write agents. Off by default on a shared demo. */
export function openRealPrs(): boolean {
  return process.env.OPEN_REAL_PRS === "true";
}

/** Vercel kills the isolate at maxDuration (800s). Leave headroom to write terminal state. */
const ISOLATE_HEADROOM_MS = 25_000;
let isolateDeadline = Number.POSITIVE_INFINITY;

export function beginIsolateBudget(maxMs = 775_000): void {
  isolateDeadline = Date.now() + maxMs;
}

export function isolateRemainingMs(): number {
  if (!Number.isFinite(isolateDeadline)) return Number.POSITIVE_INFINITY;
  return isolateDeadline - Date.now();
}

export function isolateHeadroomMs(): number {
  return ISOLATE_HEADROOM_MS;
}
