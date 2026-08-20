import type { FleetRepo } from "./fleet.js";

const SHA_RE = /^[0-9a-f]{40}$/i;
const cache = new Map<string, string>();

export function isCommitSha(ref: string): boolean {
  return SHA_RE.test(ref.trim());
}

/** owner/repo from a github.com URL. */
export function parseGitHubRepo(url: string): { owner: string; repo: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`not a GitHub URL: ${url}`);
  }
  if (!/^([a-z0-9-]+\.)?github\.com$/i.test(parsed.hostname)) {
    throw new Error(`cloud startingRef resolve needs a github.com URL, got ${url}`);
  }
  const parts = parsed.pathname.replace(/\.git$/i, "").split("/").filter(Boolean);
  const owner = parts[0];
  const repo = parts[1];
  if (!owner || !repo) throw new Error(`not a GitHub repo URL: ${url}`);
  return { owner, repo };
}

function githubToken(): string | undefined {
  return process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
}

/**
 * Resolve a branch, tag, or SHA to a commit via the GitHub commits API.
 * Cloud agents only accept a branch name or SHA; tags must be peeled first.
 */
export async function resolveCommitSha(githubUrl: string, ref: string): Promise<string> {
  const trimmed = ref.trim();
  if (!trimmed) throw new Error("empty git ref");
  if (isCommitSha(trimmed)) return trimmed.toLowerCase();

  const { owner, repo } = parseGitHubRepo(githubUrl);
  const key = `${owner}/${repo}@${trimmed}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "spec-migrator",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = githubToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(trimmed)}`,
    { headers },
  );
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 240);
    const privateHint = token ? "" : " If the repo is private, set GITHUB_TOKEN.";
    const tagHint =
      res.status === 404
        ? ` Could not resolve start_ref '${trimmed}' in ${owner}/${repo} to a commit SHA.${privateHint}`
        : "";
    throw new Error(
      `GitHub ${res.status} resolving ${owner}/${repo}@${trimmed}.${tagHint} ${body}`.trim(),
    );
  }
  const data = (await res.json()) as { sha?: string };
  if (!data.sha || !isCommitSha(data.sha)) {
    throw new Error(`GitHub commit lookup for ${key} returned no SHA`);
  }
  const sha = data.sha.toLowerCase();
  cache.set(key, sha);
  return sha;
}

/** For cloud Agent.create: tag/branch → SHA. Pass-through when already a SHA. */
export async function cloudStartingRef(
  githubUrl: string | undefined,
  ref: string | undefined,
): Promise<string | undefined> {
  if (!ref) return undefined;
  if (!githubUrl) return ref;
  return resolveCommitSha(githubUrl, ref);
}

/** Peel each repo's start_ref to a commit SHA. Live runs only. */
export async function pinFleetRepos(repos: FleetRepo[]): Promise<FleetRepo[]> {
  return Promise.all(
    repos.map(async (repo) => ({
      ...repo,
      starting_sha: await resolveCommitSha(repo.github_url, repo.start_ref),
    })),
  );
}
