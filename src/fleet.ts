import { readFileSync } from "node:fs";
import { z } from "zod";
import { ConcurrencySchema, type Concurrency } from "./concurrency.js";
import { FLEET_PATH } from "./paths.js";

const KindSchema = z.enum(["api", "batch", "web"]);
const RoleSchema = z.enum(["producer", "consumer"]);
const ResearchFromSchema = z.enum(["M1", "M4"]);

const RepoInputSchema = z.object({
  slug: z.string().min(1),
  display_name: z.string().min(1),
  github_url: z.string().url(),
  default_branch: z.string().min(1),
  /** Branch, tag, or commit SHA. Resolved to SHA at live run start. */
  start_ref: z.string().min(1).optional(),
  /** @deprecated Use start_ref. Still accepted on uploaded fleets. */
  baseline_tag: z.string().min(1).optional(),
  kind: KindSchema,
  role: RoleSchema,
  research_from: ResearchFromSchema.optional(),
  port: z.number().int().positive().optional(),
  db_port: z.number().int().positive().optional(),
});

const FleetInputSchema = z.object({
  org: z.string().min(1),
  start_ref: z.string().min(1).optional(),
  baseline_tag: z.string().min(1).optional(),
  producer: z.string().min(1),
  /** Freeform notes copied into every LEGOLAS and GIMLI prompt. Array form is joined. */
  business_context: z.union([z.string(), z.array(z.string())]).optional(),
  /** Across-repo research pairs. Default full. Within-repo LEGOLAS ∥ BILBO is not this knob. */
  research_concurrency: ConcurrencySchema.optional(),
  /** Across approved-repo write agents. Default full. */
  write_concurrency: ConcurrencySchema.optional(),
  repos: z.array(RepoInputSchema).min(1),
});

export type FleetRepo = {
  slug: string;
  display_name: string;
  github_url: string;
  default_branch: string;
  start_ref: string;
  /** Filled on live runs after GitHub resolve. Cloud + local clone use this. */
  starting_sha?: string;
  kind: z.infer<typeof KindSchema>;
  role: z.infer<typeof RoleSchema>;
  research_from?: z.infer<typeof ResearchFromSchema>;
  port?: number;
  db_port?: number;
};

export type Fleet = {
  org: string;
  start_ref?: string;
  producer: string;
  business_context?: string | string[];
  research_concurrency?: Concurrency;
  write_concurrency?: Concurrency;
  repos: FleetRepo[];
};

/** Checkout / cloud startingRef: SHA when pinned, otherwise the declared ref. */
export function pinRef(repo: FleetRepo): string {
  return repo.starting_sha ?? repo.start_ref;
}

function normalizeRepo(
  repo: z.infer<typeof RepoInputSchema>,
  fleetRef: string | undefined,
): FleetRepo {
  const { baseline_tag: _tag, start_ref, ...rest } = repo;
  return {
    ...rest,
    start_ref: start_ref ?? _tag ?? fleetRef ?? repo.default_branch,
  };
}

/** Modal and fleet.json both collapse to one prose block. */
export function businessContextProse(raw: string | string[] | undefined | null): string {
  if (raw == null) return "";
  if (Array.isArray(raw)) return raw.map((s) => s.trim()).filter(Boolean).join("\n\n");
  return raw.trim();
}

export function fleetResearchConcurrency(fleet: Fleet): Concurrency {
  return fleet.research_concurrency ?? "full";
}

export function fleetWriteConcurrency(fleet: Fleet): Concurrency {
  return fleet.write_concurrency ?? "full";
}

export function parseFleet(raw: unknown): Fleet {
  const parsed = FleetInputSchema.parse(raw);
  const fleetRef = parsed.start_ref ?? parsed.baseline_tag;
  return {
    org: parsed.org,
    start_ref: fleetRef,
    producer: parsed.producer,
    business_context: parsed.business_context,
    research_concurrency: parsed.research_concurrency,
    write_concurrency: parsed.write_concurrency,
    repos: parsed.repos.map((repo) => normalizeRepo(repo, fleetRef)),
  };
}

export function loadFleet(path: string = FLEET_PATH): Fleet {
  return parseFleet(JSON.parse(readFileSync(path, "utf8")));
}

export function consumersOf(fleet: Fleet): FleetRepo[] {
  return fleet.repos.filter((r) => r.role === "consumer");
}

export function consumers(): FleetRepo[] {
  return consumersOf(loadFleet());
}

const WAVE = { M1: 1, M4: 4 } as const;

export function researchConsumersOf(fleet: Fleet, wave: "M1" | "M4"): FleetRepo[] {
  return consumersOf(fleet).filter((r) => WAVE[r.research_from ?? "M1"] <= WAVE[wave]);
}

/** Live M1 researches all four consumers (Lighthouse pulled forward from M4). Stub fans out every consumer. */
export function researchConsumers(wave: "M1" | "M4"): FleetRepo[] {
  return researchConsumersOf(loadFleet(), wave);
}

export function producerOf(fleet: Fleet): FleetRepo {
  const repo = fleet.repos.find((r) => r.slug === fleet.producer);
  if (!repo) throw new Error(`producer slug ${fleet.producer} missing from fleet.repos`);
  return repo;
}

export function producer(): FleetRepo {
  return producerOf(loadFleet());
}

export function repoBySlug(slug: string): FleetRepo {
  const repo = loadFleet().repos.find((r) => r.slug === slug);
  if (!repo) throw new Error(`unknown fleet slug: ${slug}`);
  return repo;
}
