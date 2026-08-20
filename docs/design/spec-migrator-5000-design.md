# SPEC MIGRATOR 5000 — Design Spec (M3 Dashboard)

## Concept
Mission control for API-spec migrations. An enterprise team points it at a fleet of
repos (`fleet.json`) and a spec change (v2 → v3 diff); named agents fan out, research
every consumer, write migration specs, hold at a human gate, then execute approved
migrations as pull requests. The dashboard is the cockpit: live, streaming, clickable.

Tone: retro-industrial mission control. Think 1970s NASA console × modern dark-mode
dev tool. Serious data, playful chrome. The "5000" is a badge of honor — chunky
nameplate typography, machine-stamped verdicts, phosphor glow accents. Never cartoon.

## The Fellowship (named agents)
Every agent instance renders as a nameplate: CALLSIGN · model · repo.
- **LEGOLAS** — research agent (read-only technical impact; keen eyes, sees far). One per repo.
- **BILBO** — human-impact agent (the small unnoticed one who finds what matters to people). One per repo.
- **GIMLI** — write agent (executes approved specs, swings the axe, opens PRs). One per approved repo.
- **GOLLUM** — v3 preflight probe (M4; obsessively seeks out what the change really does — deterministic smoke-vs-baseline diff). Reserve a slot.
- **GANDALF** — the deterministic policy/validation layer (schema checks, verdict rules, the gate itself).
  NOT an agent — render it differently (badge/stamp/staff icon, no avatar) to make the point:
  probabilistic workers, deterministic judge. When a spec fails validation or holds at the
  gate, the state label is "YOU SHALL NOT PASS" — the one place the theme is allowed a punchline.
- **Bugbot** appears as an external reviewer icon on PR rows when it has commented.
Model tags always visible under callsigns (LEGOLAS · grok-4.6) — model routing is a
feature, show it. Names are text callsigns only — no Tolkien artwork, likenesses, or film
imagery anywhere in the UI.

## Screens

### 1. Mission Board (home)
- **Header:** SPEC MIGRATOR 5000 nameplate · run ID · elapsed clock · target spec
  chips: `− ssn` (removed, red), `~ name` (restructured, amber), `~ patientId`
  (restructured, amber), `= dob gender address…` (unchanged, dim).
- **Stage rail** (horizontal, always visible): DIFF → RESEARCH → GATE → WRITE →
  REPORT. Stages light in sequence; current stage pulses; GATE gets a distinct
  "HOLDING" treatment (amber beacon) when awaiting the human.
- **Fleet grid:** one card per repo.

### 2. Repo Card (the atom of the board)
- Repo name + kind glyph (api / batch / web) + port.
- Agent slots: LEGOLAS and BILBO nameplates side by side; GIMLI slot appears after
  gate approval. States: idle (dim) → running (pulse + live one-line event ticker,
  e.g. "reading config/payers.yaml…") → done (solid, duration shown).
- Verdict chip once research lands: AFFECTED (amber) / BLOCKED (red, stamped) /
  UNAFFECTED (green). Grade chip (mechanical / contextual / judgment_heavy) with
  the model it maps to. Human-impact badge: HIGH / MED / LOW.
- Terminal state stamp when write completes: MIGRATED_VERIFIED (green stamp),
  MIGRATED_WITH_FLAGS (green + amber flag), BLOCKED (red), FAILED, UNAFFECTED.
  Stamps should feel physical — slight rotation, ink texture.
- Footer links: SPEC · PR ↗ (with "Review required" pill when GitHub says so) ·
  ESCALATION (blocked repos only).

### 3. Agent Run Drawer (click any nameplate)
Slide-over panel:
- Header: callsign, model, repo, duration, attempt count.
- **Live stream tab:** the event log tailing `events.ndjson` — tool calls, files
  read, test runs, retries. Monospace, auto-scroll with pause-on-hover. This is the
  demo's money view: Cursor agents visibly working.
- **Prompt tab:** the fully assembled prompt this agent received (audit answer:
  "what did it know?").
- **Result tab:** the validated JSON output, pretty-printed, schema-pass badge.

### 4. The Gate (the centerpiece screen)
When research completes, the rail holds at GATE and the board demands the human.
Per repo, a spec review panel:
- Verdict + grade + GANDALF validation badge at top.
- Sections, collapsible: Call sites (file:line chips) · Persistence (DDL evidence) ·
  Blockers — class chip [ORGANIZATIONAL | TECHNICAL-COORDINATED] + verbatim quote
  rendered as a blockquote with file:line citation · Downstream impacts — BILBO's
  findings with quotes, HIGH/MED/LOW rating, "rating would change if…" ·
  Production verification recommendations · Grade reasoning + the model this grade
  routes to (editable dropdown = human override).
- Actions per spec: **APPROVE** (big, satisfying) · **REJECT** · approve-with-note.
  Approving flips the card's GIMLI slot to "queued"; when all decided, a single
  **RELEASE THE WRITE FAN-OUT** commit button fires M2. Blocked repos show
  **GENERATE ESCALATION** instead.

### 5. Debrief Board (terminal states)
End-of-run summary: four cards with their stamps, PR links with live GitHub status,
escalation artifact viewer (routed-to, evidence, trade-off note), run totals
(duration per stage, attempts, models used). One highlight slot per run for
annotations — e.g. "Lighthouse: research overturned the author's 'unaffected'
expectation" — small plaque treatment, because these are the stories.

## Streaming & Motion
- Data source: poll `state/<runId>/` JSON + tail `events.ndjson` (SSE if cheap,
  1s polling is fine — files are small).
- Motion vocabulary: pulse = running · sweep = stage advancing · stamp = terminal
  state (single decisive thunk, no bounce) · beacon = gate holding. No confetti.
- Everything clickable during motion; streams keep flowing in open drawers.

## Visual Language
- Dark charcoal base; phosphor green (healthy/done), signal amber (running/holding/
  affected), alarm red (blocked/failed), dim slate (idle/unchanged).
- Type: chunky display face for nameplates/stamps (industrial, not sci-fi cliché);
  clean sans for UI; monospace for streams, file:line chips, and evidence quotes.
- Texture: restrained — faint scanline or grain on stamps only. No full-screen CRT.
- Every claim on screen traces to evidence: quotes always carry file:line. The
  aesthetic is "auditable machine," and citations are part of the look.

## Empty State (the product pitch)
Before any run: "Point SPEC MIGRATOR 5000 at a fleet." Shows fleet.json contents,
the two spec files, and a single ENGAGE button. This frame is what makes it a
reusable product, not a one-off demo — any team, any repos, any spec change.

**Shipped:** a functional ENGAGE form on `:4150` (`src/dashboard.ts`) that takes the D30
inputs and previews the spec-pair diff. It is not yet the mission-control chrome above.
The next M3 session replaces/extends that page with the **flow canvas** in
`docs/design/design_handoff_spec_migrator_flow/` (not the card-grid in this doc’s
“Fleet grid” section — that layout was rejected).

## Build Notes
- Express server on :4150 reading `state/` (already exists); dashboard is static
  HTML/JS served from it. No build framework required; keep it one deployable page
  if possible. Extend `src/dashboard.ts`; do not stand up a second server.
- GitHub status (PR open/review-required, Bugbot presence) via `gh` on the server,
  cached per poll.
- Gate actions POST to the orchestrator (it already supports approve/reject).
- Reserve visual slots for GOLLUM (M4) and a "review feedback" roadmap row (grayed,
  labeled ROADMAP) — designed, deliberately deferred.
