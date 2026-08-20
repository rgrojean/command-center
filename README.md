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

Optional fleet field, also editable in the pre-run popup:

```json
{
  "business_context": [
    "Domain notes for LEGOLAS and GIMLI — compliance rules, identifier conventions, what must not be shimmed."
  ]
}
```

That array is injected into the research (LEGOLAS) and write (GIMLI) prompts only. BILBO is unchanged.

## Fleet shape

```json
{
  "org": "your-github-org",
  "baseline_tag": "baseline-v2",
  "producer": "producer_slug",
  "business_context": [],
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

Live agents clone each consumer at `baseline_tag`. On Vercel they run as Cursor **cloud** agents (no local executor). Locally they run against clones in `workspaces/`.

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
