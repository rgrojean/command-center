# Architecture Decision Records — Breaking Change Command Center

This file is in-repo context for the orchestrator, the dashboard (M3 canned
queries hang off the notes below), and anyone browsing the demo. D16–D20
originated in the session brief; D21–D26 lock the M0 implementation choices.

A source `DECISIONS.md` was not present on disk at M0; this file reconstructs
those numbered decisions from `session-orchestrator.md` plus the M0 locks
agreed in chat. Replace in place if a canonical original appears.

---

## D16 — Fixed pipeline shape, not a generic DAG

The pipeline is:

```
spec diff
  → research fan-out (per consumer repo, TWO agents in parallel)
      A. migration-research (technical)
      B. human-impact (people)
  → merge A+B into one Zod-validated spec per repo
  → HUMAN GATE (approve/reject per spec; the spec is the reviewed artifact)
  → write fan-out (approved + not-blocked) OR escalation artifact (blocked)
  → report
```

Borrow streaming and `Promise.all` fan-out idioms from
`cookbook/sdk/dag-task-runner`. Do **not** adopt its DAG JSON, complexity
ranks, or Cursor Canvas. Observability for this system is `state/` (M0) and
an Express dashboard on `:4150` (M3).

Terminal states (closed set, one enum in code):

`migrated_verified` | `migrated_with_flags` | `blocked` | `failed` | `unaffected`

The terminal artifact is an **open PR**, never a merge. Fixture repos require
code-owner review.

## D17 — Human impact is a first-class object, spliced in — not a vibe

A sibling agent answers one question: is any changed field visible to or used
by a person (UI, reports, documented workflows)? Findings cite HTML / logic /
docs. Overall rating is HIGH / MED / LOW as a **triage signal**, not a
verdict.

That agent's entire JSON output **is** `spec.downstream_impacts`. The
orchestrator assigns it; it never mechanically changes `verdict`. The human
at the gate integrates the two views.

`downstream_impacts` must include: findings, hypothesized consumers +
confidence, UAT / training / comms flags (each tied to a finding), overall
rating + rationale + what would change the rating.

## D18 — Production verification, PHI-safe

Each spec records observability gaps found in the consumer and recommended
instrumentation. Every recommendation cites a specific deficiency.

**Never recommend logging the minimized fields** (`ssn`, and after v3 the
fields being removed/restructured). The Zod schema forces `phi_safe: true`
on each gap so a live agent cannot silently omit the assertion.

## D19 — Probe after write (M4)

After PIS grows a v3 mode flag, run smokes against v3, diff vs baselines, and
attach prediction-vs-observation evidence to specs. Lighthouse joins the
researched fleet here (expected `unaffected` with evidence). Not in M0.

## D20 — Execution grade routes the write model

`execution_grade`: `mechanical` | `contextual` | `judgment_heavy`.

A config table maps grade → write-agent model. The gate may override. On
orchestrator-level retry exhaustion, escalate **one tier** and re-run the
same spec as a new agent run (audit-trailed in `state/`). Inner test-fix
retries (≤3) happen *inside* a single write-agent run and do not themselves
change the model.

Model IDs are placeholders until M2 (filled from the account's quickstart).

## D21 — Home and publication

The orchestrator lives at `cursor_sdk_project/command-center/`, its own git
repo, public on GitHub from day one. This is the demo centerpiece.

## D22 — Three Zod schemas, drafted in M0, reviewed before M1

- `src/spec-schema.ts` — full merged migration spec
- `src/human-impact-schema.ts` — the research-sibling's output; identical to
  `downstream_impacts`
- `src/write-summary-schema.ts` — write-agent terminal JSON (not prose)

Every claim-bearing item carries `evidence: { file, line?, quote }`.
`call_sites` is `{ file, line, field, usage }[]`. `persistence` is
`{ store, ddl_evidence, write_path_evidence }[]`. Blockers require verbatim
quotes. `test_impact.recommended_new_tests` includes `fails_first_because`.

The research agent's injected schema is the full spec **minus**
`downstream_impacts`.

## D23 — Deterministic A+B merge, disjoint ownership

No third LLM pass. Orchestrator does:

```
spec = { ...researchResult, downstream_impacts: humanImpactResult }
```

Research owns `verdict`, `required_changes`, `execution_grade`. Human-impact
findings never mechanically alter the verdict. Conflicts are impossible by
construction.

## D24 — `fleet.json` is the only clone map

`{ slug, github_url, default_branch, baseline_tag: "baseline-v2", kind, port?,
db_port? }` per repo, plus `role` (`producer` | `consumer`) so the pipeline
does not special-case slugs.

Clone from GitHub at `baseline-v2` into `workspaces/<slug>/`. Never reuse the
local working trees under `cursor_sdk_project/`.

Ports are reality, not the brief's aspirational numbers: PIS `4110`, Cadence
`3001`, portal `3107`, Cadence PG `5433`, claims PG `5434`, portal PG `15432`.
Lighthouse is SQLite — no `db_port`.

Slugs confirmed via `gh repo list rgrojean` (2026-08-15): `identity_service`,
`cadence_scheduling_service`, `claims_service`, `patient_portal`,
`reporting_service`.

## D25 — Two retry loops, one job each

1. **Inner (write agent):** ≤3 test-fix attempts inside a single agent run.
2. **Outer (orchestrator):** if that run still fails at the graded tier,
   re-run the same spec **once** as a new agent at the next model tier.
   Audit both attempts in `state/`.

## D26 — Stub mode is the full pipeline with zero SDK calls

`runAgent({ repo, workspace, prompt, model, mode })` is the only SDK seam.
`mode: "stub"` loads `fixtures/stubs/` with a short fake delay. `--stub`
auto-approves the gate (override with `--gate`). Fake PRs are JSON under
`state/<runId>/<slug>/fake-pr.json` — not `gh`. CI, rehearsal, and `reset.sh`
must be able to run this with no `CURSOR_API_KEY`.

Exactly two live call sites later: read-only (research + human-impact share
one) and write. Both go through `runAgent`.

---

## M3 dashboard — canned evidence queries

Derived from the notes above; implement in M3, do not invent a second source
of truth.

| Panel | Query against `state/` |
|---|---|
| Blockers | specs where `verdict = blocked`, show `blockers[].evidence.quote` |
| Human HIGH | specs where `downstream_impacts.overall_rating = HIGH` |
| Persistence | flatten `persistence[]` (DDL + write-path quotes) |
| PHI-safe instrumentation | `production_verification.gaps` where `phi_safe !== true` (should be empty) |
| Grade / model | `execution_grade` + write-agent model actually used, including escalations |
| Call sites by field | group `call_sites` by `field` |
| Fixture/golden judgment | write-summary `judgment_calls` |
| Prediction vs observation | D19 probe attachments (M4) |
