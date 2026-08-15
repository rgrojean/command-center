import { readFileSync } from "node:fs";
import { z } from "zod";
import { FLEET_PATH } from "./paths.ts";

const KindSchema = z.enum(["api", "batch", "web"]);
const RoleSchema = z.enum(["producer", "consumer"]);

export const FleetRepoSchema = z.object({
  slug: z.string().min(1),
  display_name: z.string().min(1),
  github_url: z.string().url(),
  default_branch: z.string().min(1),
  baseline_tag: z.literal("baseline-v2"),
  kind: KindSchema,
  role: RoleSchema,
  port: z.number().int().positive().optional(),
  db_port: z.number().int().positive().optional(),
});
export type FleetRepo = z.infer<typeof FleetRepoSchema>;

export const FleetSchema = z.object({
  org: z.string().min(1),
  baseline_tag: z.literal("baseline-v2"),
  producer: z.string().min(1),
  repos: z.array(FleetRepoSchema).min(1),
});
export type Fleet = z.infer<typeof FleetSchema>;

let cached: Fleet | undefined;

export function loadFleet(): Fleet {
  if (cached) return cached;
  const raw = JSON.parse(readFileSync(FLEET_PATH, "utf8"));
  cached = FleetSchema.parse(raw);
  return cached;
}

export function consumers(): FleetRepo[] {
  return loadFleet().repos.filter((r) => r.role === "consumer");
}

export function producer(): FleetRepo {
  const fleet = loadFleet();
  const repo = fleet.repos.find((r) => r.slug === fleet.producer);
  if (!repo) throw new Error(`producer slug ${fleet.producer} missing from fleet.repos`);
  return repo;
}

export function repoBySlug(slug: string): FleetRepo {
  const repo = loadFleet().repos.find((r) => r.slug === slug);
  if (!repo) throw new Error(`unknown fleet slug: ${slug}`);
  return repo;
}
