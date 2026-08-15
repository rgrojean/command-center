import { rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { consumers } from "./fleet.ts";
import { STATE_DIR, WORKSPACES_DIR } from "./paths.ts";

/**
 * Close open migration PRs, delete migration/pis-v3 branches, wipe state/
 * and workspaces/. Safe to run when nothing exists yet (M0).
 */
function tryGh(args: string[], cwd?: string): string {
  try {
    return execFileSync("gh", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return "";
  }
}

for (const repo of consumers()) {
  const slug = repo.github_url.replace(/^https:\/\/github.com\//, "");
  const prs = tryGh([
    "pr",
    "list",
    "--repo",
    slug,
    "--head",
    "migration/pis-v3",
    "--json",
    "number",
    "--jq",
    ".[].number",
  ]);
  for (const num of prs.split(/\s+/).filter(Boolean)) {
    console.log(`closing ${slug}#${num}`);
    tryGh(["pr", "close", num, "--repo", slug, "--comment", "command-center reset.sh"]);
  }
  tryGh(["api", "-X", "DELETE", `repos/${slug}/git/refs/heads/migration/pis-v3`]);
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
