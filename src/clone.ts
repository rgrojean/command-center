import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { FleetRepo } from "./fleet.ts";
import { producer } from "./fleet.ts";
import { V3_SPEC_COPY, WORKSPACES_DIR } from "./paths.ts";

export const WRITE_BRANCH = "migration/spec-v3";

export type CloneRole = "primary" | "human-impact";

export function workspaceFor(slug: string, role: CloneRole = "primary"): string {
  return role === "human-impact"
    ? join(WORKSPACES_DIR, `${slug}.bilbo`)
    : join(WORKSPACES_DIR, slug);
}

function git(dir: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    const stderr = typeof e.stderr === "string" ? e.stderr : e.stderr?.toString() ?? "";
    throw new Error(`git ${args.join(" ")} failed in ${dir}: ${stderr.trim() || e.message}`);
  }
}

function cloneUrl(repo: FleetRepo): string {
  return repo.github_url.endsWith(".git") ? repo.github_url : `${repo.github_url}.git`;
}

function checkoutBaseline(dir: string, tag: string): void {
  try {
    git(dir, ["checkout", "-f", tag]);
  } catch {
    git(dir, ["checkout", "-f", "-B", tag, `origin/${tag}`]);
  }
  git(dir, ["reset", "--hard"]);
  git(dir, ["clean", "-fdx"]);
}

/**
 * Orchestrator-owned baseline (D32). Fresh clone at baseline-v2, or on reuse:
 * checkout baseline-v2, reset --hard, clean -fdx. Agents never reconstruct this.
 */
export function restoreBaseline(repo: FleetRepo, role: CloneRole = "primary"): string {
  const dir = workspaceFor(repo.slug, role);
  if (!existsSync(join(dir, ".git"))) {
    mkdirSync(WORKSPACES_DIR, { recursive: true });
    const primary = workspaceFor(repo.slug, "primary");
    if (role === "human-impact" && existsSync(join(primary, ".git"))) {
      execFileSync("git", ["clone", "--local", primary, dir], { stdio: "inherit" });
    } else {
      execFileSync(
        "git",
        ["clone", "--branch", repo.baseline_tag, "--single-branch", "--depth", "1", cloneUrl(repo), dir],
        { stdio: "inherit" },
      );
    }
    return dir;
  }
  checkoutBaseline(dir, repo.baseline_tag);
  return dir;
}

/** Every live phase starts here so reuse cannot inherit a prior write tree. */
export function ensureClone(repo: FleetRepo): string {
  return restoreBaseline(repo, "primary");
}

/** D34: BILBO gets a sibling clone so LEGOLAS tool/test I/O cannot stall the pair. */
export function ensureBilboClone(repo: FleetRepo): string {
  if (!existsSync(join(workspaceFor(repo.slug), ".git"))) restoreBaseline(repo, "primary");
  return restoreBaseline(repo, "human-impact");
}

export function ensureProducerClone(): string {
  return ensureClone(producer());
}

export type WorkspaceInspect = {
  tracked: string[];
  untracked: string[];
  diff: string;
};

/**
 * Post-research porcelain. Tracked modifications are the gate-visible policy
 * signal (left in place). Untracked and ignored artifacts are cleaned, not
 * warned — research may run the test suite.
 */
export function inspectResearchWorkspace(dir: string): WorkspaceInspect {
  const porcelain = git(dir, ["status", "--porcelain"]);
  const tracked: string[] = [];
  const untracked: string[] = [];
  for (const raw of porcelain.split("\n")) {
    if (!raw) continue;
    const code = raw.slice(0, 2);
    const path = raw.slice(3);
    if (code === "??") untracked.push(path);
    else tracked.push(path);
  }
  const diff = tracked.length > 0 ? git(dir, ["diff", "HEAD"]) : "";
  git(dir, ["clean", "-fdx"]);
  return { tracked, untracked, diff };
}

/**
 * Restore baseline-v2, branch to migration/spec-v3, and drop a copy of the v3
 * OpenAPI for the write agent (not part of the PR).
 */
export function prepareWriteWorkspace(repo: FleetRepo, v3SpecPath: string): string {
  const dir = restoreBaseline(repo);
  git(dir, ["checkout", "-B", WRITE_BRANCH]);
  copyFileSync(v3SpecPath, join(dir, V3_SPEC_COPY));
  return dir;
}
