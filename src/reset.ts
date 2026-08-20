import { rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { WRITE_BRANCH } from "./clone.js";
import { consumers } from "./fleet.js";
import { STATE_DIR, WORKSPACES_DIR } from "./paths.js";

const BRANCH = WRITE_BRANCH;

type ExecError = Error & { status?: number; stderr?: string; stdout?: string };

function gh(args: string[]): string {
  try {
    return execFileSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    const e = err as ExecError;
    const detail = (e.stderr || e.stdout || e.message || String(err)).trim();
    throw new Error(`gh ${args.join(" ")} failed (exit ${e.status ?? "?"}): ${detail}`);
  }
}

function isMissingRef(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return /Not Found|Reference does not exist|404/i.test(text);
}

/**
 * Close open migration PRs, delete migration/spec-v3 branches, wipe state/
 * and workspaces/. Safe to run when nothing exists yet (no PRs, no branch)
 * — gh/auth failures are not swallowed.
 */
for (const repo of consumers()) {
  const slug = repo.github_url.replace(/^https:\/\/github.com\//, "");
  const prs = gh([
    "pr",
    "list",
    "--repo",
    slug,
    "--head",
    BRANCH,
    "--json",
    "number",
    "--jq",
    ".[].number",
  ]);
  const numbers = prs.split(/\s+/).filter(Boolean);
  if (numbers.length === 0) {
    console.log(`${slug}: no open ${BRANCH} PRs`);
  } else {
    for (const num of numbers) {
      console.log(`closing ${slug}#${num}`);
      gh(["pr", "close", num, "--repo", slug, "--comment", "command-center reset.sh"]);
    }
  }
  try {
    gh(["api", "-X", "DELETE", `repos/${slug}/git/refs/heads/${BRANCH}`]);
    console.log(`${slug}: deleted ${BRANCH}`);
  } catch (err) {
    if (isMissingRef(err)) {
      console.log(`${slug}: ${BRANCH} already gone`);
    } else {
      throw err;
    }
  }
}

if (existsSync(STATE_DIR)) {
  for (const name of readdirSync(STATE_DIR)) {
    if (name === ".gitkeep") continue;
    rmSync(join(STATE_DIR, name), { recursive: true, force: true });
  }
}
if (existsSync(WORKSPACES_DIR)) {
  for (const name of readdirSync(WORKSPACES_DIR)) {
    if (name === ".gitkeep") continue;
    rmSync(join(WORKSPACES_DIR, name), { recursive: true, force: true });
  }
}

console.log("reset: wiped state/ and workspaces/; migration PRs/branches closed if any.");
