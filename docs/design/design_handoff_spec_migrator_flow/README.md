# Handoff: SPEC MIGRATOR 5000 — Flow Dashboard

**Implementation status (M3, next session):** M0–M2 and D30 are done. `:4150` currently serves only the ENGAGE empty state (`src/dashboard.ts`). This bundle is the design to build next — a live canvas over `state/<runId>/`. Do not start M4.

## Overview
A single-page mission-control dashboard for API-spec migration runs. An orchestrator points named
agents at a fleet of repos and a spec change (`patient.v2 → v3`); research agents fan out per repo,
the run holds at a human gate, then write agents execute approved specs as pull requests.

The dashboard is a **left-to-right dataflow canvas**, not a card grid. One horizontal lane per repo;
six columns are the pipeline stages. Connectors between nodes animate while an agent is live ("water
flowing") and go solid once data has passed. The whole board visibly stalls at the GATE column until a
human decides, then the write column lights up lane by lane.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing intended look
and behavior, not production code to copy. `Spec Migrator Flow.dc.html` uses a small in-house
streaming-template runtime (`support.js`); do not port that runtime. Recreate the design in the target
codebase's own environment (the build notes say static HTML/JS served from an Express app on :4150 —
plain JS modules or a light framework are both fine) using its established patterns.

`reference_earlier_board_version.dc.html` is an **earlier, rejected** layout (a grid of repo cards with
separate screens). It is included only as a source of copy, evidence structure, and the Gate dossier /
Debrief content that the flow view compresses. Do not implement it as a screen.

## Fidelity
**High-fidelity.** Colors, type, spacing, motion timing, and copy are final-intent. Recreate closely.
Data is fabricated: only `cadence_scheduling_service` and `claims_service` came from the real
`fleet.json`; `patient_registry_api`, `lighthouse_member_portal`, `ledger_billing_sync`, all evidence
quotes, file:line citations, PR numbers, and durations are invented placeholders. Replace all of it with
real values from `state/<runId>/`.

---

## Layout

Page: background `#080a0b`, text `#e6eaec`, `padding-bottom: 120px` (clears the fixed transport bar).

**Header** (sticky, top, z 30): background `#0b0e10`, bottom border `1px solid #1c2226`,
padding `14px 26px`, flex row, `gap: 20px`, `align-items: center`.
- Wordmark: "SPEC MIGRATOR" Archivo 900 / 19px / `letter-spacing: .05em`, then "5000" same type,
  inverted — `color: #080a0b`, `background: #e6eaec`, `padding: 1px 7px`, `radius: 2px`.
- 1px × 26px divider `#1c2226`.
- Three stat stacks (RUN / CLOCK / PHASE): label IBM Plex Mono 11px `.14em` `#8b959b`, value Mono 12.5px.
  CLOCK turns amber when paused; PHASE turns amber at the gate, green at REPORT.
- Right: `EXPAND ALL STREAMS` toggle — Mono 12px, `1px solid #232a2f`, `padding: 8px 14px`,
  background `#232a2f` when on.

**Canvas** (`overflow-x: auto`, inner `min-width: 1560px`, `padding: 24px 26px 0`), flex row:

1. **Spec-diff panel** — fixed `214px`, `align-self: flex-start`, background `#0e1214`,
   `1px solid #1c2226`, radius 4, padding 16, `gap: 12px`. Contains: dot + "SPEC DIFF" (Archivo 800 /
   12.5px / `.14em`), `patient.v2 → v3` in Mono 12.5px `#b8c0c5`, then four field chips (Mono 12.5px,
   `padding: 5px 8px`, radius 2) — removed red, two restructured amber, unchanged slate — then a
   fleet-count footer above a `1px solid #1a2024` rule.
2. **Trunk column** — `46px`, `position: relative`, holding one absolutely positioned vertical line at
   `left: 22px; top: 46px; bottom: 90px; width: 2px`, `rgba(88,201,138,.35)` once the diff is parsed
   (`#1e2429` before). This is the bus that feeds every lane.
3. **Lane stack** — `flex: 1`, containing a column-header row then one row per repo.

**Column widths** (header row and every lane use the same track widths so they align):

| Column | Node width | Following connector |
|---|---|---|
| stub (from trunk) | 44px | — |
| FLEET (repo identity) | 186px | 40px |
| RESEARCH (LEGOLAS + BILBO) | 322px | 40px |
| GATE | 260px | 40px |
| WRITE (GIMLI) | 214px | 40px |
| REPORT (stamp + PR) | 196px | — |

Column header cell: dot + label (Archivo 800 / 12px / `.16em`; `#e6eaec` when the stage is live or
past, `#5c666d` before) + sub-label (Mono 11.5px `#8b959b`). FLEET's cell carries `padding-left: 44px`
to account for the stub track.

Lane row: `display: flex; align-items: stretch`, `border-bottom: 1px solid #1a2024`, min height driven
by content (~92px collapsed). While anything in the lane is running, the row gets a wash of
`rgba(224,164,55,.022)`.

Below the lanes, two dashed placeholder pills (`1px dashed #232a2f`, radius 3, `padding: 9px 14px`),
left-inset 44px: **GOLLUM** · "v3 preflight probe · smoke vs baseline" · `M4`, and
**REVIEW FEEDBACK** · "PR comments loop back into spec revision" · `ROADMAP`. All text `#727d84`.
These are deliberately deferred slots — keep them grayed.

**Transport bar** (fixed bottom, z 35): background `#0b0e10`, top border `#1c2226`, `padding: 12px 26px`,
flex row `gap: 16px`: `RESTART` (ghost button, Mono 12px), play/pause (Archivo 900 / 12.5px / `.14em`,
`padding: 9px 20px`), a 6px progress track (`#151a1e`, radius 3) with a green fill (amber while held at
the gate), a row of five stage marks beneath it (Mono 11px `.12em`; green once passed, amber for a held
GATE, `#5c666d` ahead), and a 190px right-aligned hint line (Mono 12.5px `#b8c0c5`).

---

## Nodes

### Repo node (FLEET)
`padding: 18px 14px 18px 0`, centered column, `gap: 5px`.
- Status dot + repo display name (Archivo 800 / 16px; `#e6eaec` once the run starts, `#5c666d` before).
  Dot: `#2b343a` idle → amber pulsing while its agents run → green when research completes, or red if
  the lane is blocked.
- `kind · :port` Mono 11.5px `#8b959b`; slug Mono 11.5px `#727d84`.

### Agent node (RESEARCH) — the core component
Two stacked nodes per lane (LEGOLAS above BILBO), `gap: 8px`, column padding `14px 0`.
Node: radius 3, `padding: 11px 12px`, `1px solid #1c2226`, background `#0b0e10` idle / `#0e1214` done /
`#12140f` with `rgba(224,164,55,.3)` border while running.

Header (the whole header is the collapse toggle button):
dot · callsign (Archivo 800 / 13px / `.14em`) · model tag (Mono 11.5px `#8b959b`) · spacer ·
elapsed or `queued` (Mono 11.5px; amber while running, `#8b959b` done, `#727d84` queued) · caret `▸`/`▾`.

**Collapsed (default):** one line under the header — the most recent stream event, lower-cased kind +
text, Mono 12px, single-line ellipsis. Amber-tinted `#d9bb7a` while running, `#a3adb2` when done,
`#727d84` while queued ("waiting for fan-out").

**Expanded:** `margin-top: 9px`, `border-top: 1px solid #1c2226`, `padding-top: 9px`,
`max-height: 184px; overflow: auto`, one row per event: timestamp (`#727d84`) · fixed 44px kind column
(DONE green, NOTE amber, everything else `#8fb8c9`) · text (`#c6cdd1`, NOTE rows `#e0c48f`), Mono 12px /
`line-height: 1.65`. While running, a trailing blinking `▌ streaming` line. Model tags stay visible in
both states — model routing is a feature.

Only events whose offset is ≤ the agent's elapsed time are rendered, so an open node visibly grows.

### Gate cell (GATE)
`padding: 14px 16px`, centered column, and **left+right 1px borders** so the stacked cells read as one
continuous vertical band: `rgba(224,164,55,.22)` borders over `rgba(224,164,55,.05)` while the gate is
holding; `#1a2024` over `rgba(255,255,255,.012)` otherwise.

Before that lane's research finishes: `awaiting research` (Mono 12px `#727d84`). After:
- Verdict chip — AFFECTED amber / BLOCKED red / UNAFFECTED green (Mono 11.5px `.1em`, `padding: 3px 8px`,
  radius 2, 10%-alpha fill + 30%-alpha border).
- GANDALF badge beside it — `GANDALF · PASS` in slate-blue `#8fb8c9`, or `GANDALF · HELD` in red.
  GANDALF is the deterministic validator, never an agent: badge treatment only, no dot, no avatar,
  no model tag.
- `grade → model` line, Mono 11.5px.
- `▸ EVIDENCE` disclosure (Mono 11.5px `#8fb8c9`). Open: `2px solid #2b343a` left rule, `padding-left: 11px`,
  a wrap of file:line chips (Mono 11.5px, `#12171a` fill, `#8fb8c9` text), then the verbatim quote in
  Mono 12px `#d2d8db` inside curly quotes, then its `file:line` citation in `#8b959b`.
  Every claim carries a citation — that is part of the aesthetic.
- Actions, affected + unblocked lanes only: `APPROVE` (Archivo 900 / 12px / `.14em`, solid `#58c98a`,
  text `#08110c`, `padding: 7px 15px`; hover `#78dfa4`) and `REJECT` (outline red).
- After deciding, the buttons are replaced by a state line (Archivo 800 / 12px / `.14em`):
  `APPROVED · QUEUED` green / `REJECTED` red / `AUTO-PASS · NO WRITE` slate for unaffected lanes /
  **`YOU SHALL NOT PASS`** red for blocked lanes. That last string is the one sanctioned punchline —
  blocked lanes only, nowhere else.

### GIMLI node (WRITE)
Appears only after release **and** an `approved` decision for that lane. Same visual construction as an
agent node (dot, callsign, elapsed) plus a one-line progress ticker that steps through the write steps
proportionally to elapsed time (`branch …` → `rewriting …` → tests → `PR #218 opened`).
When absent, the cell shows a Mono 12px `#727d84` reason: `nothing to migrate`, `no write · escalation`,
`awaiting gate`, or `write cancelled`.

### Terminal cell (REPORT)
Stamp + PR line, `gap: 8px`, or `—` while pending.
- **Stamp:** Archivo 900 / 12.5px / `.13em`, `1.5px solid <color>`, radius 2, `padding: 5px 10px`,
  `opacity: .85`, `transform: rotate(±1–1.6deg)`, and a faint scanline fill
  `repeating-linear-gradient(0deg, rgba(255,255,255,.05) 0 1px, transparent 1px 3px)`.
  Values: `MIGRATED_VERIFIED` green, `MIGRATED_WITH_FLAGS` green, `BLOCKED` red, `UNAFFECTED` slate,
  `FAILED` red. Texture appears on stamps only — no full-screen CRT effect.
- **PR line:** Mono 12px — `PR #218 ↗` slate-blue, `review required` amber, `escalated ↗` red,
  `no action` `#727d84`; optional `BUGBOT` pill (Mono 11px `.1em`, `#12171a` fill, `#8fb8c9` text) when
  the external reviewer has commented.

### Connectors ("the water")
Every connector is a full-width 2px bar, vertically centered in its 40px track, in one of three states:
- **flow** (upstream node is running): `repeating-linear-gradient(90deg, <color> 0 7px, transparent 7px 22px)`,
  `background-size: 22px 2px`, animated `background-position: 0 → 22px` over `.55s linear infinite`.
  Amber while research/write is live.
- **full** (data has passed): solid color at `opacity: .5` — green normally, red into a blocked terminal.
- **dry** (untouched): 1px `#1e2429`.

Per lane: trunk stub → repo, repo → research, research → gate, gate → write, write → report, each
switching state off its own upstream node.

---

## Interactions & Behavior

- **Autoplay on load.** A 100ms interval advances a run clock at 3.2× wall-clock. In the real product this
  is replaced by real elapsed time / real event arrival — the timeline exists so the demo can be watched
  and replayed.
- **Stage derivation from the clock:** `< 3s` DIFF · until all research nodes finish RESEARCH ·
  `GATE · HOLDING` · WRITE · REPORT. Nothing is a separate route or screen; one canvas throughout.
- **Staggered fan-out.** Research agents start at different offsets per lane (3–7s in the prototype) and
  have per-agent durations (7–25s), so lanes light up in sequence rather than all at once.
- **Hard stop at the gate.** When the clock reaches the gate time the interval clamps the clock and sets
  playing = false; the play button becomes a non-interactive `HELD AT GATE` with a pulsing amber ring
  (`box-shadow 0 → 8px rgba(224,164,55,.5)` over 1.9s). Nothing in the write column can start.
- **Release.** When every AFFECTED, unblocked lane has a decision, the run releases automatically:
  record `releaseAt = now`, resume playback, and start each lane's GIMLI at `releaseAt + offset`.
  (The earlier board version had an explicit `RELEASE THE WRITE FAN-OUT` button; keep whichever your
  orchestrator API prefers — the auto-release is what the flow view demonstrates.)
- **Streams collapsed by default**, per-node toggle plus a global expand-all. Expanded state survives
  playback; the visible event list grows as events arrive. Open streams keep flowing.
- **Everything stays clickable during motion** — evidence disclosures, stream toggles, gate actions.
- **RESTART** resets clock, playback, decisions, and evidence disclosures (deliberately keeps the
  expand-all preference).
- **Motion vocabulary:** pulse = running (`opacity 1 → .3`, 1.3s) · flow = data moving · beacon = gate
  holding · stamp = a single decisive appearance, no bounce. No confetti.
- Blocked lanes never produce a GIMLI node or a PR; they terminate in a red stamp and an escalation link.

## State Management
Prototype state, all of it derived-render:
- `t` (run clock, seconds) · `playing`
- `released` · `releaseAt` (write offsets are relative to this)
- `decisions: { [repoSlug]: 'approved' | 'rejected' }`
- `exp: { [repoSlug-CALLSIGN]: bool }` (stream disclosures) · `allStreams` (global override)
- `spec: { [repoSlug]: bool }` (evidence disclosures)

Everything else is computed each render from `t`: agent state (idle/running/done), visible event slice,
lane research completion, gate open, write state, terminal state.

**In production, replace `t` with real data:** poll `state/<runId>/*.json` (~1s is fine; files are small)
for agent status, verdicts, grades, specs, and terminal states; tail `events.ndjson` per agent for the
stream (SSE if cheap). Gate actions POST to the orchestrator's existing approve/reject endpoints.
GitHub PR status (open / review-required / Bugbot presence) comes from `gh` on the server, cached per poll.
The node/edge state machine is the only thing that needs to be right: `idle → running → done` per node,
and each connector reads its upstream node.

## Design Tokens
```
bg.page        #080a0b     bg.chrome      #0b0e10
bg.panel       #0e1214     bg.node.idle   #0b0e10   bg.node.hot   #12140f
border.hair    #1a2024     border.line    #1c2226   border.ctl    #232a2f
text.primary   #e6eaec     text.secondary #b8c0c5   text.body     #c6cdd1
text.muted     #8b959b     text.dim       #727d84   text.off      #5c666d
green (done)   #58c98a     green.hover    #78dfa4
amber (live)   #e0a437     amber.text     #d9bb7a   amber.note    #e0c48f
red (blocked)  #e05a4f     red.text       #eb8d83
blue (cite)    #8fb8c9
chip fill = base at 8–11% alpha, chip border = base at 28–32% alpha
lane wash while running = rgba(224,164,55,.022)
gate band = rgba(224,164,55,.05) fill + rgba(224,164,55,.22) borders

radius   2 (chips, buttons, stamps) · 3 (nodes) · 4 (panels)
spacing  5 · 6 · 8 · 9 · 11 · 14 · 16 · 18 · 20 · 24 · 26
type     Archivo 800/900 — callsigns, stamps, stage labels, buttons (letter-spacing .13–.16em)
         IBM Plex Sans 400/500/600 — UI prose (base 15px)
         IBM Plex Mono 400/500 — streams, file:line chips, evidence quotes, all numerics
sizes    11 / 11.5 / 12 / 12.5 / 13 / 16 / 19px   (never below 11px)
motion   flow .55s linear infinite · pulse 1.3s · beacon 1.9s · tick 100ms
```

## Assets
None. No images, icons, or SVG illustration — every glyph is text or a CSS shape (dots, bars, chips).
Callsigns are **text only**: no artwork, likenesses, or film imagery anywhere in the UI.

## Screenshots
In `screenshots/` — the same single canvas at five points in one run. Treat the live HTML as the source
of truth for color and type; these are for reading the state machine at a glance. (Captures are made by
a DOM re-renderer, so a stamp glyph or two renders imperfectly — e.g. `UNAFFECTED` may appear misdrawn.)
- `01-research-fanout.png` — staggered research; Lighthouse still running (amber node, live ticker),
  finished lanes already showing verdict + GANDALF badges, WRITE and REPORT columns dark.
- `02-gate-holding.png` — the hold: amber gate band, APPROVE / REJECT per affected lane,
  `AUTO-PASS · NO WRITE` on Registry, `YOU SHALL NOT PASS` on Ledger, transport shows `HELD AT GATE`.
- `03-write-fanout.png` — post-release; GIMLI nodes stepping through write tickers lane by lane.
- `04-terminal-report.png` — run complete: stamps and PR lines (incl. `review required` + `BUGBOT`),
  Ledger terminating red with an escalation link, deferred GOLLUM / ROADMAP pills at the bottom.
- `05-streams-expanded.png` — EXPAND ALL STREAMS: every agent's event log open in place, showing the
  timestamp / kind / text columns and how lanes grow rather than overlaying a panel.

## Files
- `Spec Migrator Flow.dc.html` — the design to implement. Open it directly in a browser; it autoplays.
  Markup and inline styles are in the template section; timing, state machine, and all placeholder data
  are in the `class Component` script below it.
- `support.js` — the prototype's template runtime. Required only to view the file locally. **Do not port.**
- `reference_earlier_board_version.dc.html` — rejected card-grid version. Use only for the fuller Gate
  dossier sections (call sites / persistence / blockers / downstream impacts / production verification /
  grade reasoning), the Debrief board, the escalation artifact, and the empty-state pitch copy, if you
  need those surfaces later.
