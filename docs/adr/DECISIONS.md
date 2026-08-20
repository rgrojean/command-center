# Breaking Change Command Center — Build Outline & Decision Log

Working name, change it. This file lives in the repo root and gets updated every time we make a real decision. It is also a demo asset: showing it during the walkthrough is itself evidence of judgment.

---

## What we're building

An agentic migration system for a healthcare enterprise. A hospital system's platform team publishes v3 of an internal **Patient Identity API** with breaking changes; v2 retires in 90 days. A fleet of consuming services has to migrate. The system takes the new OpenAPI spec as the trigger and does the engineering work — under enterprise controls.

**Pipeline:**

```
spec lands → diff analysis → impact analysis across fleet → HUMAN APPROVAL GATE
→ parallel per-repo migration agents (edit → test → read failure → retry)
→ policy/verification pass (PHI rules, contract checks)
→ structured PRs + audit trail → dashboard/report
```

**Fixture fleet (4 repos):**
- `scheduling-service` — affected, clean migration
- `claims-service` — affected, migration succeeds after one test-failure iteration (show this live)
- `patient-portal` — affected, BLOCKED: depends on a field removed in v3 → escalates a business decision instead of hallucinating a fix
- `reporting-service` — analyzed, unaffected

**Engineered demo beats:** everything green on v2 → drop `patient-identity-v3.yaml` → "3 breaking changes, 4 repos analyzed, 3 affected" → approve → parallel agents run → one visible fail/retry/converge loop → one hard block escalated → two PRs with audit artifacts → report.

**Effort allocation:** ~70% agent behavior / 20% enterprise controls / 10% UI. UI is cards + streaming status, nothing more.

---

## Decision log

Format for every entry: **Decision / Alternatives considered / Why / What would change our mind.**

### D1 — Trigger: API spec diff, not regulation text
- **Alternatives:** regulation/compliance-text trigger (original plan); CVE/incident webhook (Gemini's suggestion).
- **Why:** a spec diff is deterministic and machine-verifiable — the analysis step can't hallucinate, and tests give objective pass/fail. Regulation text requires interpretation before it becomes code change (squishy, slow, risky live). CVE auto-fix is the crowded, obvious demo the brief warns against ("not a basic integration") and is single-repo by nature.
- **Reversal condition:** none for the exercise. "What if the trigger is a compliance mandate?" is a prepared extension answer, not the core.

### D2 — Vertical: healthcare, not finserv
- **Alternatives:** bank / Customer Identity API framing.
- **Why:** healthcare is the likely open vertical; PHI constraints give the policy layer real teeth; Moderna/PHI-redaction story is credibility only I have. Demo mechanics are identical either way.

### D3 — Blast radius: fleet fan-out, not single repo
- **Alternatives:** deep single-repo remediation loop.
- **Why:** the brief explicitly rewards asynchronous/multi-step. Fan-out with a coordination problem in the middle is a structurally bigger use of the SDK (parallel agents, run state, streaming events) than one repo + retries. 3-4 small repos, not a 50-repo simulator — craft over completeness.

### D4 — Human approval gate before any merge
- **Alternatives:** full autonomy; auto-merge on green tests.
- **Why:** regulated buyers don't fear AI writing code, they fear ungoverned change at scale. The gate + evidence trail IS the product for this buyer. Also gives the reviewer a structured artifact to approve (see D7).

### D5 — Blocked-repo escalation is a real policy, not theater
- **Alternatives:** hardcode the block for demo reliability.
- **Why:** interviewers probe. The block must emerge from an actual rule the verification agent enforces (removed field with downstream dependency / PII rule) so the mechanism survives inspection — and so "change the policy" is itself a 5-minute live extension.

### D6 — Execution: local agents for the live run; one pre-completed cloud-agent run as an artifact
- **Alternatives:** all-cloud (fragile live: VM spin-up, latency); all-local (weaker enterprise story).
- **Why:** demo reliability beats infrastructure bragging. Show completed cloud-run PRs/audit trail from a prior run; execute live locally. Talk the production deployment story with proof, without betting 20 minutes on it.

### D7 — PR body as compliance artifact
- Every generated PR carries: root-cause/impact summary, changed files, test execution results, risk rating, policy checks passed. Cheap to build, makes the approval gate concrete, on-brand for audit-trail story.

### D8 — Iterative verification loop, shown live
- Agents run tests, read stderr, patch, retry (bounded retry budget). One visible fail→fix→pass iteration in the demo — more convincing than first-try success, and demonstrates real SDK usage (streaming, run state) vs one-shot prompting.

### D9 — Runbook update: architected seam, not built
- Most likely interviewer extension ask. Design the hook so it's a 15-minute add; leave it undone on purpose. Same treatment for: Slack/notification step, new policy rule, add-a-repo, rollback path.

### D10 — Stack: TypeScript, `@cursor/sdk`
- Native SDK support, strict typing. Orchestrator state in something dead simple (JSON/SQLite) — see the scale answer for why that's a prototype choice, not a production one.

### D11 — The v3 spec is a FHIR R4 alignment, producing three kinds of breaking change
- **Decision:** v2 is a bespoke convenience wrapper (lossy facade over the EHR: flattened name, bare patientId, SSN exposed). v3 aligns the internal API to FHIR R4 Patient. Three breaking changes, one per kind: (1) **removal** — SSN not populated (data minimization; post-breach mandate; drives the vault-blocked repo and the two-class consumer split); (2) **restructure** — `name` string → HumanName list with `given`/`family`/`use` (patient matching; the contextual change that earns the agent over a codemod); (3) **re-identification** — `patientId` → namespaced `identifier` {system, value} list (post-merger EMPI consolidation; forces select-the-identifier in every consumer).
- **Alternatives:** single-change diff (SSN only — skews mechanical, invites "why not a codemod"); invented non-FHIR restructure (fails "why was v2 like that" probing).
- **Why:** one coherent rationale covers the whole diff — the org is paying for FHIR fluency anyway (CMS-0057-class mandates, Jan 2027), the merger needs namespaced IDs regardless, and internal alignment retires a private dialect plus a permanent translation layer. Alignment is deliberately **incremental**: this release changes only the three compliance/merger-critical surfaces; `dob`, `gender`, `address`, and the paging envelope survive unchanged (blast-radius bounding — don't batch unrelated breaks; full conformance is a later wave). If probed on "why isn't v3 fully FHIR": that staging IS the expand/contract discipline, applied to the alignment itself. Realism receipts if probed: 2024–26 breach wave (Change Healthcare 192.7M; SSNs in routine breach lists), CMS-0057-F deadlines, "Falsehoods Programmers Believe About Names," HL7v2→FHIR history.
- **Demo note:** the affected/unaffected/blocked classification gains credibility because different repos hit different change-kinds differently; consumer failure catalog to narrate: strict deserializer (binds-without-using), key-swap identifier user, spread-into-storage vs NOT NULL column (runtime write-path failure that green unit tests miss — smoke test justification), self-healing dynamic UI (with the human-reader caveat), vault-class statutory need (architectural block).

### D12 — Fleet topology: five real GitHub repos, not folders in one repo
- **Decision:** four consumer apps + one spec/orchestrator repo in a free GitHub org. Each app 150–300 lines, real runnable code with real passing tests, cast one-per-consumer-shape: scheduling-service "Cadence" (generated typed client + strict Zod boundary — binds-without-using, breaks on deserialization), claims-service "ClaimBridge" (unvalidated JSON, SSN as payer-mandated subscriber ID + remit-match tiebreaker → statutory need, vault-blocked), patient-portal "MyRiverbend" (plain-JS wholesale copy into NOT NULL cache column — runtime write-path failure — plus dynamically rendered profile/admin views and a documented clerk phone-verification workflow: the DOM-diff target and human-workflow flag), reporting-service "Lighthouse" (explicit four-field projection binding only unchanged fields — correctly unaffected; its monthly/quarterly cadence is also the telemetry-blind-spot story). Plus a ~50-line mock identity API serving v2 so "everything green" is real.
- **Alternatives:** one repo with four folders (deletes the cross-repo coordination problem the demo exists to show); local-only git (loses real PRs).
- **Why:** per-repo clones, PRs, CI, CODEOWNERS, and gray merge buttons are the containment-vessel story rendered by GitHub itself; also prerequisite for the D6 cloud-run artifact. All TypeScript except the portal (consumer-shape heterogeneity is the point; language heterogeneity is deferred — "polyglot is a prompt-config change").

### D13 — Human-workflow flag on user-visible changes (browser-automation "check through to the person" rejected)
- **Decision:** the verification pass flags PRs whose changes alter user-visible output: *human-workflow review recommended — rendered content changed*, with before/after evidence attached (see D14).
- **Alternative rejected:** agent drives a browser post-migration to "verify the UI." It would find the page renders correctly — for the self-healing dynamic UI that's true — while the actual break (a clerk's phone-verification workflow) exists in no repo, DOM, or artifact. The human consumer class has zero machine-readable footprint; automating past the pixels checks nothing.
- **Why:** draws the automation boundary where the reasoning puts it — machines detect and evidence that a visible surface changed; only humans judge whether a workflow depended on it. Third escalation lane alongside blocked-for-vault and blocked-for-schema.

### D14 — Baseline capture stage: golden masters, API-level everywhere, DOM-level for the portal
- **Decision:** before execution, the orchestrator captures baselines — each app's v2 endpoint responses as golden files (all repos), plus rendered-HTML/DOM capture for patient-portal. Post-migration, replay and structurally diff. UI diff output ("row 'SSN': present → absent") attaches to the D13 flag as evidence.
- **Alternatives:** screenshot/pixel diffing (brittle: fonts, antialiasing — rejected); no baselines (leaves "did behavior change?" to unit tests alone, which miss semantic drift).
- **Why:** the old system is the oracle — capture-then-diff converts "did the agent preserve behavior?" into machine-readable feedback with near-zero flake; adds a verification layer between "tests pass" and "human approves." Cost ~1–2h, contained.

### D15 — Fleet construction: independent blind sessions, shared contract only
- **Decision:** each repo is built in a separate coding session that knows nothing of the other apps — only its own product narrative plus the PIS v2 OpenAPI contract and sample payloads (Session 0 builds PIS first; its `openapi.yaml` seeds every app session). Baseline prompt + per-app acceptance criteria live in `build-prompts.md`.
- **Alternatives:** one session builds everything (produces suspiciously uniform code — deletes the Conway's-law texture the demo depends on); full shared context (agents cross-pollinate idioms and pre-solve the migration).
- **Why:** independent construction is how the real fleet got heterogeneous — teams share API docs, never code. The per-app acceptance criteria exist because modern coding agents sand off flaws by default (add validation, fix the name splitter, upgrade to TypeScript); every load-bearing wart is pinned as a mandatory criterion and double-checked at review, since a sanded wart silently deletes a demo beat. The orchestrator session, by contrast, gets everything — the platform team reads everyone's code.

### D16 — Per-repo research agents write migration specs; the gate reviews specs, not a list
- **Decision:** impact analysis becomes a read-only fan-out — one research agent per repo, in parallel, each producing a schema-validated migration spec (call sites file:line, required changes per breaking change for this codebase, test impact, risk flags, confidence, blockers). The human gate reviews the N specs; approved specs are the executors' input. Pipeline: diff → research fan-out (read-only, pre-gate) → specs → gate → write fan-out.
- **Alternatives:** analysis emits only affected/unaffected verdicts (gate approves a list — interpretations stay latent until diffs land); single fleet-wide analysis doc (loses per-repo precision, harder to review).
- **Why:** materializes the interpretation checkpoint — researcher and executor share a model family, so a misread spec would be executed faithfully; putting the interpretation in a reviewable artifact at the last sequential moment before fan-out converts a silently replicated correlated error into a ten-second catch. Read-only work is safe pre-approval. Analysis-detectable blocks (ClaimBridge's payers.yaml SSN mandate, MyRiverbend's NOT NULL DDL) surface at the gate before any code is touched; caveat for the room — some blocks only surface at execution. Model routing lands concretely: frontier model for research (reasoning-heavy, once per repo), cheaper model for execution (spec-bound, test-verified). Spec doubles as the PR body's rationale section → the audit artifact writes itself. Demo beat: click a repo card at the gate, read the agent's stated intent before authorizing it.

---

## Pre-answered hard questions (Austin: this is where people trip)

Write the real answers here as the build produces them. Every answer should cite something in this repo.

### "What happens at 10x — 40 repos, 400 repos?"
- Fan-out becomes a queue problem: bounded concurrency (agent pool size = f(rate limits, cost budget)), not unbounded parallel spawn.
- Batch by dependency graph — migrate leaf consumers before services others depend on; canary waves (5 repos → validate → next wave), not big-bang.
- Idempotent, resumable per-repo state so a failure at repo 212 doesn't restart the fleet. [RED: fill in what the prototype actually persists per run]
- Cost: per-repo token/run budget, cheap impact-analysis pass filters the fleet before expensive migration agents launch.
- Human gate scales by exception: green-path PRs batch-approved, only blocks and policy flags demand individual attention.

### "Why this backend / persistence / orchestration choice over X?"
- Prototype: single-process orchestrator + simple persisted state. Production shape: queue + workers (SQS/Temporal-flavor), same pipeline stages. The stages are the design; the transport is swappable — and say exactly that.
- Git/PRs as the system of record on purpose: it's where enterprise review, audit, and rollback already live. Don't invent a parallel change-management system.
- [RED: after building — actual answer for why Node vs Bun, actual state store chosen and its failure mode]

### "Why model X vs model Y?"
- Tiered by task: reasoning-heavy model for spec-diff + impact analysis (correctness-critical, runs once), faster/cheaper model for mechanical per-repo edits (runs N times, verified by tests anyway — the test loop is the safety net that makes a cheaper model acceptable).
- Lived precedent: same pattern shipped in Fiona — tiered routing cut cost-per-request ~70-75%. Use this; it's an answer with production evidence, not theory.
- [RED: record which models the SDK actually exposes and which you picked per stage, with one latency/cost number from your own runs]

### Other questions in the same vein — draft answers as they come up
- **Secrets/PII in agent context:** what the agents can and can't see; why the spec + code is in scope but data is not. [RED]
- **Two repos conflict / shared library:** current answer is dependency-ordered batching (see 10x); what breaks. [RED]
- **Hallucination containment:** tests + policy pass + human gate = three independent checks; agent can escalate "I can't" (D5) instead of inventing.
- **Retry budgets:** why bounded (cost + a failing agent looping is a signal, not a nuisance). [RED: actual budget chosen]
- **Failure mid-fan-out:** per-repo isolation — one blocked repo doesn't stop the fleet; report shows partial completion honestly.
- **Why Cursor SDK vs raw LLM API:** durable agents against real workspaces, command execution, run state, cloud agents against cloned repos — the orchestration substrate is the product, not the completion call.

### "Why is the SDK the best surface for this? Why couldn't I do this in the IDE or the agents interface?" (per Austin — expect this)
- **Litmus: who invokes the agent, and who consumes its output.** IDE and agents interface: a human types the prompt, a human reads the result. Here: a spec landing invokes the pipeline, and *software* consumes every intermediate output — impact analysis parsed into an affected-repo list, test results driving retries, policy verdicts gating PR creation, per-repo results aggregating into the report. When agent output is input to code, you've left every interactive surface. The SDK is for the agent as a component inside a system, not a tool in front of a person.
- **Four structural supports (each maps to a pipeline stage they just watched):**
  1. The trigger has no human in it — the spec lands via webhook/CI; nobody is at an IDE.
  2. Coordination is programmatic — dependency ordering, bounded concurrency, per-repo state, shared halt conditions are control flow *between* runs; the agents interface runs tasks, not control flow.
  3. The controls are custom code — the policy/verification pass and PHI rules wrap every run; interactive surfaces give you their guardrails, the SDK lets you impose yours (the regulated-enterprise requirement).
  4. Evidence is a first-class output — structured PR artifacts, audit trail, consolidated report are assembled from run data against our compliance schema; no interactive surface knows that schema.
- **Close by flipping it (know the boundary both directions):** the IDE is where a human and the model think together — used it to build this system. The agents interface is where a human delegates one scoped task — right surface for a single-repo fix. The SDK is where the *organization* delegates a workflow and humans enter only at decision points. Same agent underneath; three answers to who's driving.

### "How do you create deterministic checks for a non-deterministic system?"
- **Thesis:** you don't make the model deterministic — you make the acceptance criteria deterministic. Sandwich architecture: deterministic input (structured spec/diff) → probabilistic middle (agent) → deterministic validators out. A probabilistic component is never the last thing that touches an output.
- **Validator stack, cheapest → strongest, every layer binary:** (1) structural — output parses against a schema or is rejected/retried; (2) build — compiles or doesn't; (3) tests — existing + generated characterization tests, deterministic given the code however stochastically produced; (4) diff-level policy — static rules on the diff (allowed paths, no removed redaction calls, no new deps) = deterministic linting of probabilistic output (the PHI pass); (5) oracle comparison — run old vs new on same inputs, diff outputs; the incumbent is ground truth where no spec exists.
- **Determinism of process, not just checks:** each attempt is stochastic; the orchestration is a finite state machine — bounded retries, cost caps, timeouts, closed set of terminal states per repo (migrated-and-verified / blocked-with-reason / escalated). Can't guarantee what the agent writes; can guarantee the universe of outcomes. The blocked patient-portal repo is this principle live.
- **Anti-pattern to name:** LLM-as-judge is a probabilistic check on a probabilistic system — triage signal, never a gate; gates are code. Temperature-zero narrows variance, guarantees nothing.
- **Builder's angle:** the fixture fleet doubles as an eval harness — change a prompt/model, re-run the pipeline, diff terminal states; regression testing for the nondeterministic part itself.

---

## Build order (~10-20 hrs)

1. Fixture fleet: 4 tiny repos with real tests, consuming a fake v2 client. Get them green. (~2-3h)
2. Spec diff + impact analysis stage → correct affected/unaffected verdicts. (~2-3h)
3. Single-repo migration agent with test loop → works on `scheduling-service`. (~3-4h)
4. Parallelize across fleet + approval gate + per-repo state. (~2-3h)
5. Policy/verification pass + the real blocking rule for `patient-portal`. (~2h)
6. PR artifacts + audit trail + minimal dashboard. (~2h)
7. One cloud-agent run captured as artifact; rehearse the 20-min demo twice; fill every [RED] above. (~2h)

Cut from the bottom, never from stages 2-5.

---

## Logistics (do today if not done)
- Personal Cursor account signed in; recruiter emailed for credits.
- [RED: confirm SDK model access on personal account before hour 5]

### Note — Dashboard evidence panels (for orchestrator session)
Per-repo read-only evidence panels in the Command Center, not in fixtures (fixtures stay period-accurate; agents read them). Canned/whitelisted queries only — no live SQL typing. ClaimBridge: claims table incl. ssn column (before/after-block beat), remit + exception counts, outbox/ 837 viewer. Cadence: canned API call. MyRiverbend: iframe of portal page. Lighthouse: latest report file.

### Note — Demo staging: agents are the visible heroes (for demo script)
Risk: the orchestrator/dashboard eats the camera time and Cursor's agents become an invisible progress bar. Staging rules: (1) stream agent work live and at length — click into at least two agent streams (research agent reasoning to the payers.yaml blocker; write agent hitting the red golden-file test and regenerating it) and narrate over them; (2) at the gate, credit the specs' file:line call sites as Cursor's comprehension, schema-checked by us; (3) dividing-line sentence, used twice: "Nothing I wrote reads a line of TypeScript — every act of code understanding here is a Cursor agent; my code decides when to ask and whether to accept the answer"; (4) live extension happens in the Cursor IDE with Cursor's help — Cursor improving the system that orchestrates Cursor. Rehearsal metric: of ~20 demo minutes, agent-visibly-working minutes should exceed half; if not, restage. System earns screen time at exactly two beats: the gate and the terminal-states board.

### D17 — Specs predict organizational blast radius, not just code changes
- **Decision:** extend the migration spec schema with a `downstream_impacts` section: human workflows discovered in documentation (with evidence quotes), hypothesized undocumented consumers (with confidence as a triage signal), predicted UAT regressions, recommended new tests (proposed, gate-reviewed — never silently added), and training/comms flags. Research agent prompt instructs doc-scanning + consumer hypothesis, not just call-site discovery. Gate renders it as its own panel.
- **Alternatives:** code-scoped specs only (Intercom-style auto-approval maturity — industrializes "safe to merge," never asks "what does this do to the organization"); separate change-management agent/stage (more machinery, no more value).
- **Why:** blast radius of an API change is organizational — the portal's clerk phone-verification workflow exists only in prose docs and is invisible to code search; a doc-reading research agent surfacing it as "SSN verification workflow → procedure change + staff retraining, high confidence" is the thesis in one artifact (generalizes D13's human-workflow flag + D9's runbook seam). In regulated-industries terms: automated CAB packet (impacted parties, UAT scope, training impacts). Honest limits, stated in the room: confidence = sort order for human attention, not calibrated probability; hypothesized consumers are unverifiable by construction — the system converts unknown-unknowns into a checklist of known-unknowns for a human to confirm. Lighthouse provides the bounded negative case (downstream impacts: none). Cost: schema fields + prompt lines + one gate panel. Live-extension candidate: "add training-impact prediction to the spec" (upgrades D9's runbook idea — extends the thesis, not just plumbing).

### D18 — Specs recommend production verification (observability), evidence-tethered
- **Decision:** add a `production_verification` section to the migration spec: existing signals, discovered observability gaps (each citing specific evidence — a swallowed catch block, a silent cadence, an unmeasured fallback), and recommended instrumentation (deprecation/usage counters on PIS v2 fields for expand-contract retirement, ClaimBridge match-rate metric, portal synthetic login check, Lighthouse structured errors + post-migration run). Recommendations are gate-reviewed and routed "for platform team" — never silently implemented by the write agent.
- **Alternatives:** end verification at tests+smoke (leaves "how do we know it worked in production?" unanswered — the question every CAB asks); build actual monitoring stack (scope explosion, zero thesis gain).
- **Why:** the fixtures argue for it — Lighthouse's two-word "fetch failed" IS the telemetry blind spot wart; migration moments are when real orgs add deprecation telemetry (Hyrum's Law detection = logging). Framing: every change ships with the instrumentation needed to prove itself. Quality bar (anti-slop rule): no recommendation without a cited specific deficiency. Vertical-specific hazard to state unprompted: agents must never recommend logging the fields being minimized — PHI-in-logs is its own breach surface. Cost: schema section + prompt lines + gate panel row. Live-extension candidate (now three on the bench: runbook D9, training-impact D17, production-verification D18).

### D19 — Empirical v3 probe is the corroboration stage, not the impact analysis
- **Decision:** after research specs are produced (and typically after the gate), run a deterministic "v3 preflight": PIS mock in v3 mode, each runnable consumer exercised via its smoke path, outputs diffed against D14 baselines. Results are attached to specs as prediction-vs-observation evidence.
- **Alternatives:** empirical-first impact detection ("point the fleet at v3 and see what breaks") — rejected as the analysis mechanism because it measures crash-on-contact, not correctness: it catches Cadence (loud Zod throw) and the portal (NOT NULL), and waves through ClaimBridge (green batch, corrupted 837s) and every human consumer; at real scale most repos aren't bootable in a lab and batch cadences hide failures for months.
- **Why:** reading finds silent dependencies and documented humans; running confirms loud ones and grades the specs. Demo beat: "research predicted ClaimBridge would NOT crash but would corrupt output — here's the green run and the NM1 diff proving it." Bonus census: fixture-swap contract tests only exist where consumers validate (Cadence alone) — the fleet's test reaction to v3 measures testing maturity, not impact. No SDK required; build as a small deterministic module after the walking skeleton.

### D20 — Research agents grade execution difficulty; config maps grades to models
- **Decision:** spec schema gains `execution_grade: mechanical | contextual | judgment_heavy` + `grade_reasoning` (evidence-tied). A deterministic config table maps grade → model for the write agent; the gate displays grade + reasoning and can override via dropdown. On retry exhaustion, the orchestrator escalates one tier and re-runs once before declaring `failed` (audit-trailed).
- **Alternatives:** static stage-level routing only (D16 baseline — treats Cadence's mechanical client regen and the portal's contextual EJS/name work as the same job); agent emits a literal model name (rejected: probabilistic component making a spend decision + model names go stale — violates the judge principle).
- **Why:** the researcher is the only component that knows difficulty pre-execution; per-task routing turns the analysis phase into the pricing function for the execution phase (enterprise cost story, Intercom cost-per-PR vocabulary). Probabilistic signal in, deterministic policy out; human override at the gate. Escalate-on-failure makes mis-grades self-correcting and generates grade-vs-outcome data (shadow-table pattern — grades earn trust over time). Cost: one schema field, one config map, ~10 lines.

### D21 — Home: `command-center/` as its own public GitHub repo
- **Decision:** the orchestrator lives at `cursor_sdk_project/command-center/`, initialized as its own git repo and pushed public from day one (`rgrojean/command-center`). This file lives at `docs/adr/DECISIONS.md`.
- **Alternatives:** keep it as an unversioned folder next to the fixtures; delay the GitHub remote until M3.
- **Why:** this repo is the demo centerpiece and will be browsed; PRs, CODEOWNERS, and the audit trail only mean anything if the orchestrator itself is a real repo.
- **Reversal condition:** a private staging remote is fine for rehearsal, but the walkthrough artifact stays public.

### D22 — Three Zod schemas, drafted in M0, reviewed before M1
- **Decision:** `src/spec-schema.ts` (full merged spec), `src/human-impact-schema.ts` (identical to `downstream_impacts`), `src/write-summary-schema.ts` (write-agent terminal JSON, not prose). Every claim-bearing item carries `evidence: { file, line?, quote }`. `call_sites` is `{ file, line, field, usage }[]`. `persistence` is `{ store, ddl_evidence, write_path_evidence }[]`. Blockers require verbatim quotes. `test_impact.recommended_new_tests` includes `fails_first_because`. Observability gaps require `phi_safe: true`. Downstream flags `tied_to_finding` must match a finding summary.
- **Alternatives:** one loosely-typed JSON blob; prose write-agent output parsed with an LLM.
- **Why:** the sandwich (D16 / “deterministic checks”) starts at the schema. A missing citation or an orphaned training flag fails validation the same way a live agent would — stub fixtures already parse against these contracts.
- **Reversal condition:** a field that cannot be evidenced should move to `hypothesized_consumers`, not weaken `evidence`.

### D23 — Deterministic A+B merge, disjoint ownership
- **Decision:** no third LLM pass. Research agent's injected schema is the full spec minus `downstream_impacts`. Human-impact agent's entire output **is** that object (including HIGH/MED/LOW). Orchestrator assigns `spec.downstream_impacts = humanImpactResult`. Research owns `verdict`, `required_changes`, `execution_grade`. Human-impact findings never mechanically alter the verdict. Conflicts are impossible by construction.
- **Alternatives:** a merger agent; let human-impact flip `verdict` to blocked when rating is HIGH.
- **Why:** the gate is where a human integrates the two views. ClaimBridge is the proof case — MED-with-a-HIGH-finding next to a research `blocked` that stays blocked.
- **Reversal condition:** a policy in `src/policies.ts` may annotate, not overwrite, `verdict`.

### D24 — `fleet.json` is the only clone map
- **Decision:** `{ slug, github_url, default_branch, baseline_tag: "baseline-v2", kind, port?, db_port? }` per repo, plus `role` (`producer` | `consumer`) and `research_from` (`M1` | `M4`). Clone from GitHub at `baseline-v2` into `workspaces/<slug>/`. Never reuse the sibling working trees under `cursor_sdk_project/`. Ports are the running stack: PIS `4110`, Cadence `3001`, portal `3107`, Cadence PG `5433`, claims PG `5434`, portal PG `15432`. Lighthouse is SQLite. Slugs confirmed via `gh repo list rgrojean` (2026-08-15).
- **Alternatives:** hardcode URLs in the pipeline; clone from local paths for speed.
- **Why:** local working trees drift; the tag is the demo's ground truth. Aspirational ports in the session brief (`4120`/`4130`) are superseded.
- **Reversal condition:** a sixth consumer is a `fleet.json` row, not a pipeline edit.

### D25 — Two retry loops, one job each
- **Decision:** (1) Inner — the write agent's ≤3 test-fix attempts happen inside a single agent run. (2) Outer — if that run still fails at the graded tier, re-run the same spec once as a new agent at the next model tier, audit-trailed in `state/`. Schema-invalid research/human-impact output gets one retry (M1) with the Zod error appended; that is a parse retry, not a model-tier escalation.
- **Alternatives:** orchestrator-driven test loops; unbounded retries; escalate on every test failure.
- **Why:** inner failures are the agent doing its job; outer escalation is the D20 mis-grade valve. Mixing them hides which one fired.
- **Reversal condition:** a measured inner-budget that is always exhausted (wrong grade) should move work into the outer loop, not raise the inner cap.

### D26 — Stub mode is the full pipeline with zero SDK calls
- **Decision:** `runAgent({ repo, workspace, prompt, model, mode })` is the only SDK seam. `mode: "stub"` loads `fixtures/stubs/` with a short fake delay. `--stub` auto-approves the gate (override with `--gate`). Fake PRs are JSON under `state/<runId>/<slug>/fake-pr.json`. Exactly two live call sites: read-only (research + human-impact share one) and write. Both go through `runAgent`.
- **Alternatives:** skip stub and always hit the SDK; mock at the HTTP layer.
- **Why:** CI, rehearsal, and `reset.sh` must run with no `CURSOR_API_KEY`. Stub fixtures encode the expected narrative and are never concatenated into live prompts.
- **Reversal condition:** none for M0–M2; live is an additional mode, not a replacement.

### D27 — Spec cross-field consistency (M1 schema refinements)
- **Decision:** three refinements, no structural field changes. (1) `verdict === "blocked"` iff `blockers.length >= 1` *(amended by D28: iff ≥1 organizational blocker)*. (2) `verdict === "unaffected"` requires `evidence.length >= 1` — proof of absence, not an empty search. (3) `execution_grade` and `grade_reasoning` are required when `verdict === "affected"` and optional otherwise (grading a blocked or unaffected repo is meaningless).
- **Alternatives:** keep grade required on every spec; allow blocked-without-blockers as a soft warning.
- **Why:** a blocked verdict without a quoted blocker is an opinion; an unaffected verdict without a citation is a shrug. Both would have passed a field-list schema and failed the demo under inspection.
- **Reversal condition:** a fourth verdict would need its own presence/absence rule, not a loosening of these three.

### D28 — Blocker classes (organizational vs technical_coordinated)
- **Decision:** `BlockerSchema` gains `class: "organizational" | "technical_coordinated"`. `organizational` = unresolvable by changes within this repo (statutory/payer mandates, missing external services, credentials or approvals required) → forces `verdict: blocked`. `technical_coordinated` = resolvable entirely within this repo but only as coordinated changes shipping together (e.g., schema migration + write path + views in one PR) → does not force blocked; verdict stays `affected`, the blocker rides in the spec, and `required_changes` must sequence the coordinated steps explicitly. Amends D27 (1): `verdict === "blocked"` iff there is ≥1 organizational blocker. Technical_coordinated blockers with `affected` are valid; an organizational blocker with any other verdict is not.
- **Alternatives:** keep "any blocker ⇒ blocked" (D27 as written); two separate arrays; treat coordinated work as `required_changes` only, with no blocker object.
- **Why:** the portal's `ssn TEXT NOT NULL` is a real coordination hazard the gate should see, but it is solvable in this repo. Collapsing it with ClaimBridge's payer mandate made the research agent escalate a migratable repo. Class splits "cannot ship from this repo" from "must ship as one PR."
- **Reversal condition:** a third class (e.g. an external API version lock that is neither organizational nor in-repo) would need its own force-blocked rule, not a reuse of these two.

### D29 — Blocker boundary rule
- **Decision:** a blocker (either class) must prevent the migrated code itself from being correct, complete, or compliant — e.g., the change violates an external obligation (ClaimBridge's payer mandate) or depends on infrastructure outside the repo. Consequences that require people or processes to adapt after the change ships (procedure updates, retraining, comms) are NOT blockers — they belong in `downstream_impacts`, rated by the human-impact agent, decided at the gate. Research prompt discriminator, verbatim: "Test: does this prevent the code change, or does it require humans to adapt to the code change? Only the first is a blocker."
- **Alternatives:** treat any documented human procedure as an organizational blocker (the D28 live miss on the portal clerk script); fold human-impact HIGH into `verdict`.
- **Why:** D28 split *how* a blocker is resolved (in-repo vs not). It did not split *whether the thing is a blocker*. The portal clerk last-four script is a real HIGH finding and a real training/comms item; the code can still be correct without it. Collapsing that into `organizational` re-blocked a migratable repo.
- **Reversal condition:** a statutory rule that the *running system* must keep presenting SSN to clerks would be an organizational blocker, because the migrated code would then be non-compliant. A script that clerks must update after SSN disappears is downstream impact.

### D30 — Derive breaking fields from the diff
- **Decision:** remove the hardcoded `ssn | name | patientId` enum. The diff module's output is the source of truth: `call_sites.field` validates against a Zod enum built at runtime from the fields the diff actually found, and `{{DIFF_SUMMARY}}` in every agent prompt renders from the same object. Internally the diff stays removed / type-changed / added; the **rendered** summary pairs each removal to its successors via OpenAPI `x-replaces` on the v3 properties (so write agents see `name` → `given[]`/`family`, `patientId` → `identifier[]`, and a removal with no successor). CLI and the M3 ENGAGE empty state take two spec paths plus a `fleet.json` path. Riverbend's three fields must arrive dynamically from those YAMLs, not from an enum in `src/`.
- **Alternatives:** keep the three-field enum (fast, but the orchestrator cannot be aimed at another producer); parse breaking fields from prompt text.
- **Why:** a command center that only knows this hospital's Patient schema is a demo toy. The sandwich still holds — deterministic diff in, schema-checked specs out — but the lock is "whatever this spec pair changed," not three string literals.
- **Roadmap:** real-world spec diffs need a breaking-vs-additive classifier (removed or type-changed = breaking; purely added = safe). Ours is trivially all-breaking by construction — the v3 fixture only replaces identity surfaces; additive-only properties are recorded and excluded from `fields`, but we do not yet classify nested/request/response/path changes.
- **Reversal condition:** a producer whose "breaks" cannot be read from a Patient (or equivalent) schema diff would need a different diff target, not a return to a hardcoded enum.

### D31 — Lighthouse is affected (research overturned the fixture author's expectation)
- **Decision:** accept live research's `verdict: affected` / `execution_grade: contextual` on `reporting_service`. The explicit four-field pick includes the restructured `patientId`; mapping `identifier[]` into that pick is in-repo work. Do **not** rewrite the stub fixture to match the old "unaffected" story — fixtures stay period-accurate (D26); the live spec is the correction.
- **Alternatives:** force `unaffected` because marts/CSVs omit identity fields; patch the fixture so stub and live agree.
- **Why:** D27's proof-of-absence example assumed projection dropped all three changed fields. Live research showed `patientId` is one of the four picked fields, so v3's identifier reshape is a real collector change even though published reports stay clean.
- **Reversal condition:** if `pick()` is later changed to drop `patientId` entirely (dedup by something unchanged), `unaffected` would be correct and the fixture would match reality.

### D32 — Workspace lifecycle: phase boundaries restore known state
- **Decision:** the orchestrator owns the clone baseline. Every phase boundary restores a known tree: before research and before write, `ensureClone` / `restoreBaseline` either fresh-clones at `baseline-v2` or, on reuse, `git checkout baseline-v2 && git reset --hard && git clean -fdx`. Prompt rules are requests; boundary scripts are the guarantee. After research, tracked-file modifications are a gate-visible policy signal (`workspace_hygiene` on the spec, diff attached, human decides) and do not overwrite `verdict` (D23). Untracked artifacts are logged and cleaned, not warned. Research may run the test suite — evidence is valuable; hygiene makes that consequence-free. Agents must not reconstruct the baseline (`git show <oldcommit>^` archaeology).
- **Alternatives:** reuse an existing clone as-is (the previous `ensureClone` — research then analyzes a leftover write tree); trust prompt "MUST NOT edit" as the hygiene guarantee; treat any porcelain as a warning, including test artifacts; auto-reset tracked edits after research (hides the policy signal).
- **Why:** Cadence's contaminated-tree miss — LEGOLAS grepped an already-migrated `migration/pis-v3` clone and reconstructed v2 via git history instead of reading the baseline. That is the failure mode this prevents. A prompt cannot guarantee a clean tree; a checkout/reset/clean at the boundary can.
- **Reversal condition:** a workspace that cannot be reset (uncommitted human work the operator intends to keep) would need an explicit opt-out, not a return to silent reuse.

### D33 — Across-repo fan-out is full by default; degrade in the open
- **Decision:** `research_concurrency` and `write_concurrency` live on `fleet.json` (`"full"` | positive integer | `"sequential"`), default `"full"`. Across-repo, all research *pairs* (and later all approved writes) launch simultaneously. Within a repo the LEGOLAS + BILBO pair still launches in parallel — that pairing is proven and is not this knob. On rate-limit / capacity errors the orchestrator stops starting new work, lets in-flight finish, and retries leftovers down the ladder **full → pool(2) → sequential**. Each step is a run event (`concurrency_degraded`) and a board note in the RESEARCH / WRITE column header; degradation is never silent. If pair-level workspace collisions ever surface (both agents mutating test caches in the same clone), the fix is a second read-only clone for BILBO — not serializing the pair.
- **Alternatives:** keep live one-repo-at-a-time (the previous default — safe, but the research wall-clock is the sum of pairs instead of the max); serialize LEGOLAS then BILBO inside a repo (rejects proven overlap); drop concurrency on capacity and fail the run.
- **Why:** eight agents at once is what the board is for. Rate limits are real, so the ladder exists; hiding the drop would make a sequential run look like a fast one.
- **Reversal condition:** a producer whose clones cannot be isolated per repo (shared working tree) would need a different isolation story, not a return to a silent one-repo queue.

### D34 — Pair isolation, first-object JSON, idle stream retry
- **Decision:** (1) BILBO live research uses a sibling clone (`workspaces/<slug>.bilbo`), restored to `baseline-v2` like the primary; LEGOLAS keeps `workspaces/<slug>`. Hygiene inspects the primary tree. Do not serialize the pair. (2) `extractJson` parses the first complete `{…}` (string-aware); trailing braces or prose after a valid object are ignored. (3) A non-capacity failure in one research pair marks that repo `failed` and continues the fan-out (`repo_isolated` run event). Capacity errors still degrade; dashboard kill still aborts the run. (4) Live `run.stream()` with no event for 90s is cancelled and retried once; a second idle fails that agent, not the fleet.
- **Alternatives:** serialize LEGOLAS then BILBO (rejects proven overlap); fail the whole run on one parse error (the 2026-08-18T15-40-03 miss); trust "JSON only" in the prompt; wait forever on a silent stream.
- **Why:** Cadence BILBO got `run_started` and then zero tokens while grok held the same cwd; Lighthouse/MyRiverbend grok emitted a valid spec plus one extra `}`. Last-brace parse and fleet-wide abort turned those into a FAILED board.
- **Reversal condition:** if the SDK grows a constrained JSON decoder, keep first-object parse as belt-and-suspenders. If local runtimes guarantee per-agent cwd isolation, the extra BILBO clone can be dropped.
