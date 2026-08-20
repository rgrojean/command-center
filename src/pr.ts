import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { FleetRepo } from "./fleet.js";
import { WRITE_BRANCH } from "./clone.js";
import { prBody, prTitle } from "./fake-pr.js";
import { V3_SPEC_COPY } from "./paths.js";
import type { MigrationSpec } from "./spec-schema.js";
import type { WriteSummary } from "./write-summary-schema.js";

export type OpenedPullRequest = {
  stub: false;
  repo: string;
  github_url: string;
  branch: typeof WRITE_BRANCH;
  title: string;
  body: string;
  url: string;
  number?: number;
};

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

/**
 * Commit the write-agent working tree and open a GitHub PR. Never merges.
 * The v3 OpenAPI copy is unstaged so it does not land in the consumer repo.
 */
export function openPullRequest(opts: {
  repo: FleetRepo;
  workspace: string;
  spec: MigrationSpec;
  summary: WriteSummary;
}): OpenedPullRequest {
  const title = prTitle(opts.repo);
  const body = prBody(opts.spec, opts.summary);
  git(opts.workspace, ["add", "-A"]);
  try {
    git(opts.workspace, ["reset", "HEAD", "--", V3_SPEC_COPY]);
  } catch {
    // copy may already be untracked
  }
  const staged = git(opts.workspace, ["diff", "--cached", "--name-only"]);
  if (staged) {
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Spec Migrator",
        "-c",
        "user.email=spec-migrator@users.noreply.github.com",
        "commit",
        "-m",
        title,
      ],
      { cwd: opts.workspace, stdio: "pipe" },
    );
  }
  git(opts.workspace, ["push", "-u", "origin", `HEAD:${WRITE_BRANCH}`]);

  const slug = opts.repo.github_url.replace(/^https:\/\/github.com\//, "");
  const url = execFileSync(
    "gh",
    [
      "pr",
      "create",
      "--repo",
      slug,
      "--base",
      opts.repo.default_branch,
      "--head",
      WRITE_BRANCH,
      "--title",
      title,
      "--body",
      body,
    ],
    { cwd: opts.workspace, encoding: "utf8" },
  ).trim();

  return {
    stub: false,
    repo: opts.repo.slug,
    github_url: opts.repo.github_url,
    branch: WRITE_BRANCH,
    title,
    body,
    url,
  };
}

/** Exists so callers can join the copy path without importing paths twice. */
export function v3SpecCopyPath(workspace: string): string {
  return join(workspace, V3_SPEC_COPY);
}
