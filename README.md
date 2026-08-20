# Spec Migrator 5000

Point two OpenAPI specs and a `fleet.json` at a set of consuming repos. The orchestrator diffs the spec pair, fans out research agents (LEGOLAS) plus a human-impact pass (BILBO), holds for a human gate, then write agents (GIMLI) implement approved specs.

The bundled sample is a healthcare identity API. The product is not: prompts, the diff, and the dashboard are spec-agnostic. Swap the YAMLs and fleet to run a different producer.

```
spec diff → dual research fan-out → merge → gate → write / escalate → report
```

Terminal states: `migrated_verified` | `migrated_with_flags` | `blocked` | `failed` | `unaffected`. Artifact is an **open PR** (or a demo PR JSON), never a merge.

## Hosted demo

Password: `rcgcursordemo`

LIVE uses the operator’s `CURSOR_API_KEY` for everyone on the demo. Stub rehearsal needs no key.

GitHub: [rgrojean/command-center](https://github.com/rgrojean/command-center)

Import that repo in Vercel ([Deploy](https://vercel.com/new/clone?repository-url=https://github.com/rgrojean/command-center)) and set:

| Env | Value |
|---|---|
| `CURSOR_API_KEY` | your Cursor user key (Dashboard → Integrations) |
| `APP_PASSWORD` | `rcgcursordemo` |
| `OPEN_REAL_PRS` | `false` |
| `GITHUB_TOKEN` | optional; needed to resolve `baseline_tag` on private fleet repos |

Anonymous/temporary Vercel deploys only ship `public/` static files. A logged-in Git import is required so Express (the pipeline) is built as a function. On Vercel, LIVE agents run in Cursor cloud (no local executor).

## Run locally

```bash
npm install
cp .env.example .env   # set CURSOR_API_KEY for LIVE
npm start              # dashboard on :4150
```

Stub pipeline (no SDK, no key):

```bash
npm run pipeline -- --stub
```

Live research (needs `CURSOR_API_KEY` or `Cursor.auth.login`):

```bash
npm run pipeline -- --live --yes
```

## Inputs

| File | What |
|---|---|
| Current spec (v2) | OpenAPI 3 YAML or JSON |
| New spec (v3) | Breaking successor. `x-replaces` on a new property names its predecessor. |
| `fleet.json` | Producer + consumers, GitHub URLs, baseline tags |

Defaults ship in `specs/` and `fleet.json`. The dashboard can upload replacements, or download the sample fleet as a template.

Optional fleet field, also editable in the pre-run popup as freeform prose:

```json
{
  "business_context": "Patients are addressed by given/family in comms. Do not add a compatibility field for anything the v3 spec removed."
}
```

A string array is still accepted and joined into one block. That text is copied into every research (LEGOLAS) and write (GIMLI) prompt. BILBO is unchanged.

## Fleet shape

```json
{
  "org": "your-github-org",
  "baseline_tag": "baseline-v2",
  "producer": "producer_slug",
  "business_context": "",
  "research_concurrency": "full",
  "write_concurrency": "full",
  "repos": [
    {
      "slug": "producer_slug",
      "display_name": "Producer API",
      "github_url": "https://github.com/org/producer",
      "default_branch": "main",
      "baseline_tag": "baseline-v2",
      "kind": "api",
      "role": "producer"
    },
    {
      "slug": "consumer_slug",
      "display_name": "Consumer",
      "github_url": "https://github.com/org/consumer",
      "default_branch": "main",
      "baseline_tag": "baseline-v2",
      "kind": "api",
      "role": "consumer"
    }
  ]
}
```

Live agents start from `baseline_tag`. Local clones accept a tag (`git clone --branch`). Cursor cloud agents only accept a **branch name or commit SHA**, so tags are resolved to SHAs via the GitHub API before a cloud agent starts. Private fleet repos need `GITHUB_TOKEN`.

Set `OPEN_REAL_PRS=true` only if write agents should push GitHub PRs. The hosted demo leaves this off.

## Layout

- `src/spec-schema.ts` / `human-impact-schema.ts` / `write-summary-schema.ts` — Zod contracts
- `src/run-agent.ts` — the one SDK seam (`mode: "live" | "stub"`)
- `src/agents.ts` — read-only (LEGOLAS + BILBO) and write (GIMLI)
- `prompts/` — templates; `{{BUSINESS_CONTEXT}}` and `{{DIFF_SUMMARY}}` are substituted
- `fixtures/stubs/` — canned outputs for `--stub`
- `docs/adr/DECISIONS.md` — historical decision log (the original healthcare sample)

```bash
npm run reset          # close migration PRs, delete branches, wipe state/ + workspaces/
npm run pipeline -- --stub --gate   # interactive y/n even in stub
```

## Env

| Variable | Purpose |
|---|---|
| `CURSOR_API_KEY` | LIVE agents (everyone on the hosted demo shares the operator key) |
| `APP_PASSWORD` | Dashboard password (default `rcgcursordemo`) |
| `OPEN_REAL_PRS` | `true` to `git push` / `gh pr create` from write |
| `CURSOR_RUNTIME` | `cloud` or `local` (Vercel defaults to cloud) |
| `PORT` | Dashboard port (default `4150`) |
