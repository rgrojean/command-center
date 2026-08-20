import type { MigrationSpec } from "./spec-schema.js";

/**
 * Soft seam (session brief). Policies can rewrite or annotate a spec after
 * merge and before the gate. Empty in M0 — the merge rule is already
 * disjoint, so we do not need a policy to "protect" verdict from human-impact.
 */
export type Policy = {
  id: string;
  description: string;
  apply: (spec: MigrationSpec) => MigrationSpec;
};

export const policies: Policy[] = [];

export function applyPolicies(spec: MigrationSpec): MigrationSpec {
  return policies.reduce((current, policy) => policy.apply(current), spec);
}
