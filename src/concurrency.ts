import { z } from "zod";

/** Across-repo fan-out. Within a repo, LEGOLAS ∥ BILBO is always a pair. */
export type Concurrency = "full" | "sequential" | number;

export const ConcurrencySchema = z.union([
  z.literal("full"),
  z.literal("sequential"),
  z.number().int().min(1),
]);

export class CapacityError extends Error {
  readonly code = "CAPACITY";
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "CapacityError";
  }
}

export function parseConcurrency(raw: unknown, fallback: Concurrency = "full"): Concurrency {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const parsed = ConcurrencySchema.safeParse(
    typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw,
  );
  if (!parsed.success) {
    throw new Error(
      `invalid concurrency ${JSON.stringify(raw)} (want "full" | positive integer | "sequential")`,
    );
  }
  return parsed.data;
}

export function poolSize(concurrency: Concurrency, n: number): number {
  if (n <= 0) return 0;
  if (concurrency === "sequential") return 1;
  if (concurrency === "full") return n;
  return Math.min(n, Math.max(1, concurrency));
}

export function labelConcurrency(concurrency: Concurrency): string {
  if (concurrency === "full" || concurrency === "sequential") return concurrency;
  return `pool(${concurrency})`;
}

/** Ladder: full → pool(2) → sequential. A configured pool(n>2) also drops to 2, then sequential. */
export function nextRung(concurrency: Concurrency): Concurrency | undefined {
  if (concurrency === "full") return 2;
  if (concurrency === "sequential") return undefined;
  if (concurrency > 2) return 2;
  if (concurrency === 2) return "sequential";
  return undefined;
}

export function isCapacityError(err: unknown): boolean {
  if (err instanceof CapacityError) return true;
  const parts: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur; i++) {
    if (typeof cur === "object" && cur !== null && "status" in cur) {
      const status = (cur as { status?: unknown }).status;
      if (status === 429 || status === 503) return true;
    }
    if (cur instanceof Error) {
      parts.push(cur.name, cur.message);
      cur = cur.cause;
      continue;
    }
    parts.push(String(cur));
    break;
  }
  return /rate.?limit|429|too many (requests|agents|executors)|resource.?exhaust|overloaded|capacit(y|ies)|concurrent.{0,20}limit|try again later|resource.?limit/i.test(
    parts.join(" "),
  );
}

export type FanoutRecord = {
  requested: Concurrency;
  effective: Concurrency;
  degraded: boolean;
  ladder: string[];
  reason?: string;
};

export function initialFanout(requested: Concurrency): FanoutRecord {
  const label = labelConcurrency(requested);
  return { requested, effective: requested, degraded: false, ladder: [label] };
}

export function applyDegrade(
  record: FanoutRecord,
  from: Concurrency,
  to: Concurrency,
  reason: string,
): FanoutRecord {
  return {
    ...record,
    effective: to,
    degraded: true,
    ladder: [...record.ladder, labelConcurrency(to)],
    reason,
  };
}

export function fanoutNote(record: FanoutRecord | undefined): string | undefined {
  if (!record) return undefined;
  if (record.degraded) {
    return `${record.ladder.join(" → ")}`;
  }
  return labelConcurrency(record.effective);
}

/**
 * Run `fn` across items with across-item concurrency. On rate-limit/capacity,
 * stop starting new work, let in-flight finish, retry leftovers at the next
 * ladder rung. Non-capacity errors abort the fan-out.
 */
export async function mapFanout<T, R>(
  items: readonly T[],
  requested: Concurrency,
  fn: (item: T, index: number) => Promise<R>,
  onDegrade: (from: Concurrency, to: Concurrency, reason: string) => void,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  const pending = new Set(items.map((_, i) => i));
  let level: Concurrency = requested;

  while (pending.size > 0) {
    const indexes = [...pending];
    const size = poolSize(level, indexes.length);
    const completed = new Set<number>();
    const capacityHits: { index: number; err: unknown }[] = [];
    let haltNew = false;
    let cursor = 0;
    let fatal: unknown;

    async function slot(): Promise<void> {
      while (!haltNew && !fatal) {
        const pos = cursor++;
        if (pos >= indexes.length) return;
        const index = indexes[pos]!;
        try {
          out[index] = await fn(items[index]!, index);
          completed.add(index);
        } catch (err) {
          if (isCapacityError(err)) {
            haltNew = true;
            capacityHits.push({ index, err });
            return;
          }
          fatal = err;
          haltNew = true;
          return;
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(size, indexes.length) }, () => slot()));
    if (fatal) throw fatal;

    for (const i of completed) pending.delete(i);
    if (capacityHits.length === 0) {
      if (pending.size === 0) break;
      continue;
    }

    const next = nextRung(level);
    const reason =
      capacityHits[0]!.err instanceof Error
        ? capacityHits[0]!.err.message
        : String(capacityHits[0]!.err);
    if (!next) {
      throw new CapacityError(
        `capacity error at sequential concurrency: ${reason}`,
        capacityHits[0]!.err,
      );
    }
    onDegrade(level, next, reason);
    level = next;
  }

  return out;
}
