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

/**
 * Hobby Fluid max is 300s even if vercel.json asks for 800. Pro can honor 800.
 * Production logs timed out at 300s; leave headroom to stamp terminal state.
 */
export const VERCEL_ISOLATE_BUDGET_MS = 270_000;
export const LOCAL_ISOLATE_BUDGET_MS = 775_000;
const ISOLATE_HEADROOM_MS = 25_000;
let isolateDeadline = Number.POSITIVE_INFINITY;

export function beginIsolateBudget(maxMs = LOCAL_ISOLATE_BUDGET_MS): void {
  isolateDeadline = Date.now() + maxMs;
}

export function isolateRemainingMs(): number {
  if (!Number.isFinite(isolateDeadline)) return Number.POSITIVE_INFINITY;
  return isolateDeadline - Date.now();
}

export function isolateHeadroomMs(): number {
  return ISOLATE_HEADROOM_MS;
}
