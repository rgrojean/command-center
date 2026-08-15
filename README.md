# Breaking Change Command Center

Agentic migration pipeline on the [Cursor SDK](https://cursor.com/docs/sdk/typescript). When the Patient Identity Service publishes a breaking v3 spec, this repo researches every consumer, holds a human gate on the specs, and opens migration PRs.

M0 is the stub rehearsal: the full pipeline runs with **zero SDK calls** and **no API key**.

```bash
npm install
npm run pipeline -- --stub
```

Expect `<10s`, a printed gate for each consumer, fake-PR JSON under `state/<runId>/`, and a terminal-state board.

```
spec diff → dual research fan-out → merge → gate → write / escalate → report
```

Terminal states: `migrated_verified` | `migrated_with_flags` | `blocked` | `failed` | `unaffected`. Artifact is an **open PR**, never a merge.

## Fleet

Clones come from GitHub at `baseline-v2` into `workspaces/<slug>/` — never from the sibling working trees in `cursor_sdk_project/`. Ports are the running stack, not the session-brief's aspirational numbers.

| Slug | Name | Kind | Port | DB |
|---|---|---|---|---|
| `identity_service` | PIS (producer) | api | 4110 | — |
| `cadence_scheduling_service` | Cadence | api | 3001 | 5433 |
| `claims_service` | ClaimBridge | batch | — | 5434 |
| `patient_portal` | MyRiverbend | web | 3107 | 15432 |
| `reporting_service` | Lighthouse | batch | — | sqlite |

Source of truth: [`fleet.json`](./fleet.json).

## Layout

- `src/spec-schema.ts` / `human-impact-schema.ts` / `write-summary-schema.ts` — the three Zod contracts (review at M0 before M1)
- `src/run-agent.ts` — the one SDK seam (`mode: "live" | "stub"`)
- `src/agents.ts` — two call sites: read-only (research + human-impact) and write
- `prompts/` — agent templates; live agents see spec diff + task, never stub narratives
- `fixtures/stubs/` — canned outputs for `--stub`
- `docs/adr/DECISIONS.md` — D16–D26
- `state/<runId>/manifest.json` + `<slug>/events.ndjson`

```bash
npm run reset          # close migration PRs, delete branches, wipe state/ + workspaces/
npm run pipeline -- --stub --gate   # interactive y/n even in stub
```

## Milestones

| | What |
|---|---|
| **M0** | This repo, stub harness, skeleton pipeline. You are here. |
| M1 | Real v3 OpenAPI + live dual-agent research on Cadence, ClaimBridge, portal |
| M2 | Live write fan-out + real `gh` PRs |
| M3 | Express dashboard `:4150` |
| M4 | PIS v3 mode, D19 probe, Lighthouse live |
