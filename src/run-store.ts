import { getCache } from "@vercel/functions";
import type { BoardSnapshot } from "./board-payload.js";
import type { HttpDecision } from "./hold.js";

type RemoteCtl = {
  decisions: Record<string, HttpDecision>;
  release?: boolean;
  abort?: string;
};

export type CloudHandle = {
  repo: string;
  kind: string;
  agentId: string;
  runId: string;
};

const g = globalThis as typeof globalThis & {
  __smBoard?: Map<string, BoardSnapshot>;
  __smCtl?: Map<string, RemoteCtl>;
  __smCloud?: Map<string, CloudHandle[]>;
};

function boards(): Map<string, BoardSnapshot> {
  return (g.__smBoard ??= new Map());
}

function ctls(): Map<string, RemoteCtl> {
  return (g.__smCtl ??= new Map());
}

function cloudHandles(): Map<string, CloudHandle[]> {
  return (g.__smCloud ??= new Map());
}

function runtimeCache() {
  try {
    return getCache({ namespace: "spec-migrator" });
  } catch {
    return undefined;
  }
}

export async function publishBoard(runId: string, board: BoardSnapshot): Promise<void> {
  boards().set(runId, board);
  try {
    await runtimeCache()?.set(`board:${runId}`, board, { ttl: 60 * 60, name: "run-board" });
  } catch {
    /* local Node or missing runtime cache */
  }
}

export async function loadCachedBoard(runId: string): Promise<BoardSnapshot | undefined> {
  const local = boards().get(runId);
  if (local) return local;
  try {
    const value = await runtimeCache()?.get(`board:${runId}`);
    if (value && typeof value === "object") return value as BoardSnapshot;
  } catch {
    /* */
  }
  return undefined;
}

async function readCtl(runId: string): Promise<RemoteCtl> {
  const local = ctls().get(runId);
  if (local) return local;
  try {
    const value = await runtimeCache()?.get(`ctl:${runId}`);
    if (value && typeof value === "object") return value as RemoteCtl;
  } catch {
    /* */
  }
  return { decisions: {} };
}

async function writeCtl(runId: string, ctl: RemoteCtl): Promise<void> {
  ctls().set(runId, ctl);
  try {
    await runtimeCache()?.set(`ctl:${runId}`, ctl, { ttl: 60 * 60, name: "run-ctl" });
  } catch {
    /* */
  }
}

export async function publishDecision(
  runId: string,
  slug: string,
  record: HttpDecision,
): Promise<void> {
  const ctl = await readCtl(runId);
  ctl.decisions[slug] = record;
  await writeCtl(runId, ctl);
}

export async function publishRelease(runId: string): Promise<void> {
  const ctl = await readCtl(runId);
  ctl.release = true;
  await writeCtl(runId, ctl);
}

export async function publishAbort(runId: string, reason: string): Promise<void> {
  const ctl = await readCtl(runId);
  ctl.abort = reason;
  await writeCtl(runId, ctl);
}

/** Owner isolate: apply and clear remote gate/kill commands. */
export async function takeRemoteCtl(runId: string): Promise<RemoteCtl> {
  const ctl = await readCtl(runId);
  const empty = !ctl.release && !ctl.abort && Object.keys(ctl.decisions).length === 0;
  if (empty) return ctl;
  await writeCtl(runId, { decisions: {} });
  return ctl;
}

async function readHandles(runId: string): Promise<CloudHandle[]> {
  const local = cloudHandles().get(runId);
  if (local) return local;
  try {
    const value = await runtimeCache()?.get(`cloud:${runId}`);
    if (Array.isArray(value)) return value as CloudHandle[];
  } catch {
    /* */
  }
  return [];
}

async function writeHandles(runId: string, handles: CloudHandle[]): Promise<void> {
  cloudHandles().set(runId, handles);
  try {
    await runtimeCache()?.set(`cloud:${runId}`, handles, { ttl: 60 * 60, name: "cloud-runs" });
  } catch {
    /* */
  }
}

export async function publishCloudHandle(runId: string, handle: CloudHandle): Promise<void> {
  const cur = await readHandles(runId);
  await writeHandles(
    runId,
    [...cur.filter((h) => h.runId !== handle.runId), handle],
  );
}

export async function dropCloudHandle(runId: string, sdkRunId: string): Promise<void> {
  const cur = await readHandles(runId);
  await writeHandles(
    runId,
    cur.filter((h) => h.runId !== sdkRunId),
  );
}

export async function listCloudHandles(runId: string): Promise<CloudHandle[]> {
  return readHandles(runId);
}
