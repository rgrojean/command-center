/* global document */
const ArchitectureDrawer = (() => {
  const KIND = {
    det: "Deterministic",
    agent: "Non-deterministic",
    human: "Human",
  };

  const DECISIONS = [
    ["d1", "guarantee", "D1 / D30", "Trigger is an OpenAPI schema diff, not an agent reading YAML", "src/diff.ts → diffOpenApi", "Removed or type-changed = breaking. Added recorded, excluded from fields. x-replaces pairs successors into {{DIFF_SUMMARY}}."],
    ["d30g", "guarantee", "D30", "No hardcoded field list in orchestrator or prompts", "src/assert-no-hardcoded-breaks.ts", "Guard script fails CI if ssn/name/patientId enums reappear in src/ or prompts/."],
    ["d30s", "schema", "D30", "call_sites.field is a runtime Zod enum from the diff", "src/evidence.ts · src/spec-schema.ts", "pipeline.ts builds schemas from diff.fields before any agent runs."],
    ["d17", "prompt", "D17", "Two agents, two lenses, same clone", "src/agents.ts · prompts/", "LEGOLAS = technical. BILBO = people. researchPair launches both in Promise.all."],
    ["d23", "guarantee", "D23", "Deterministic splice; human-impact cannot flip verdict", "src/merge.ts", "spec.downstream_impacts = human result. One assignment. No merger LLM."],
    ["d22", "schema", "D22", "Agents emit schema-validated JSON, not prose", "src/spec-schema.ts · human-impact-schema.ts · write-summary-schema.ts", "EvidenceSchema requires quote. runValidated retries once on Zod failure, then throws."],
    ["d27", "schema", "D27–D29", "Cross-field consistency + blocker classes + boundary test", "src/spec-schema.ts · prompts/research-agent.md", "blocked iff ≥1 organizational. unaffected needs evidence[]. D29 boundary is a prompt sentence; class split is schema."],
    ["d20", "guarantee", "D20", "Grade in, model out — agent never names the model", "src/models.ts", "mechanical/contextual/judgment_heavy → config table. HTTP gate can override grade or model."],
    ["d16", "guarantee", "D16 / D4", "Gate reviews English specs between research and write", "src/gate.ts · src/hold.ts", "CLI is y/N. Dashboard is per-repo approve/reject + optional note/grade/model; write starts on that repo without waiting for the rest of the fleet. Blocked never enters write even if approved."],
    ["d25", "guarantee", "D25 / D8", "Two retry loops, one job each", "src/pipeline.ts", "Inner ≤3 test-fix inside one agent run. Outer: one model-tier climb if writeRunFailed. Schema retry is neither."],
    ["d32ws", "guarantee", "D32 (ADR)", "Workspace lifecycle is scripts, not prompts", "src/clone.ts", "checkout the run's starting SHA, reset --hard, clean -fdx before research and before write."],
    ["d7", "guarantee", "D7 / D5", "Orchestrator owns git/PR; agents never push", "src/pr.ts · src/fake-pr.ts", "PR body assembled from the spec. Never merges. Blocked repos get escalation.json."],
    ["d26", "guarantee", "D26", "One SDK seam; stub is the full pipeline", "src/run-agent.ts", "mode stub loads fixtures/stubs/. Chip is LIVE vs STUB REHEARSAL."],
    ["d33", "guarantee", "D33", "Fan-out is config; degrade in the open", "src/concurrency.ts · fleet.json", "full → pool(2) → sequential. LEGOLAS∥BILBO is not this knob."],
    ["d24", "guarantee", "D24", "fleet.json is the only clone map", "fleet.json · src/fleet.ts", "Sixth consumer is a row. research_from M1|M4 is the probe-wave hook."],
    ["term", "guarantee", "closed set", "Five terminals, no sixth", "src/terminal-states.ts", "migrated_verified | migrated_with_flags | blocked | failed | unaffected."],
    ["state", "guarantee", "substrate", "Agents are stateless; assembled prompts are logged", "src/state.ts", "state/<runId>/<slug>/{research,human-impact,write}.prompt.md plus spec.json."],
    ["json", "prompt", "prompts", "Behavior changes are English; schema is inline JSON", "src/prompts.ts · src/json-schema.ts", "{{DIFF_SUMMARY}} injected. $refStrategy: none on purpose."],
    ["hygiene-pol", "seam", "D32 vs policies[]", "Hygiene is a tripwire, but not a Policy tenant", "src/policies.ts · src/pipeline.ts", "workspace_hygiene is annotated in pipeline. policies[] is empty — the live-extension hook."],
    ["note", "seam", "HTTP note", "Reviewer note exists; write prompt ignores it", "src/hold.ts · src/http.ts · src/gate.ts", "gate_note stored on manifest. applyDecisionToSpec only copies grade_override."],
    ["notify", "seam", "D9", "Notifier is a no-op by design", "src/notifier.ts", "Already called on every terminal transition. Fill the body."],
    ["d19", "seam", "D19 / M4", "Probe is designed, not built", "README · public/app.js", "GOLLUM pill only. research_from M4 is unused."],
    ["d14", "seam", "D14 / D13", "Golden-master / DOM baseline capture not in this repo", "docs/adr/DECISIONS.md", "Write prompt allows golden regen; orchestrator does not oracle-compare."],
    ["classifier", "seam", "D30 roadmap", "Breaking classifier is trivial by construction", "src/diff.ts", "Shared component object schemas. Path changes are noted, not fatal."],
  ];

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function files(paths) {
    return `<div class="arch-files">${paths.map((p) => `<code>${esc(p)}</code>`).join("")}</div>`;
  }

  function stage(title, kind, does, paths) {
    return `<div class="arch-stage">
      <div class="arch-kind ${kind}"></div>
      <div class="arch-stage-body">
        <div class="arch-stage-head">
          <span class="arch-stage-title">${esc(title)}</span>
          <span class="arch-kind-label">${KIND[kind]}</span>
        </div>
        <p>${esc(does)}</p>
        ${files(paths)}
      </div>
    </div>`;
  }

  function rail(inner, last) {
    return `<div class="arch-rail${last ? " last" : ""}">
      <div class="arch-track"><i class="arch-dot"></i><i class="arch-line"></i></div>
      <div class="arch-rail-body">${inner}</div>
    </div>`;
  }

  function agentCard(name, does, paths) {
    return stage(name, "agent", does, paths);
  }

  function pipelineHtml() {
    return [
      rail(stage(
        "Doorway",
        "det",
        "CLI or dashboard starts one run. Stub auto-approves the gate unless --gate. Live defaults to --until=gate. Same pipeline function either way.",
        ["src/index.ts", "src/dashboard.ts", "src/http.ts", "src/pipeline.ts"],
      )),
      rail(stage(
        "Inputs + clone map",
        "det",
        "Two OpenAPI paths plus fleet.json. Live peels each repo's start_ref (branch, tag, or SHA) to a commit and clones that tree — not a drifted working copy. A new consumer is a fleet row, not a pipeline edit.",
        ["fleet.json", "src/fleet.ts", "src/clone.ts", "specs/pis-openapi-v2.yaml", "specs/pis-openapi-v3.yaml"],
      )),
      rail(stage(
        "Spec diff",
        "det",
        "Structural OpenAPI schema diff. Removed or type-changed become breaking fields; purely added are recorded and excluded. x-replaces pairs successors into the summary agents see. Path changes are noted, not fatal. This is the trigger — no agent reads the YAMLs.",
        ["src/diff.ts", "src/assert-no-hardcoded-breaks.ts"],
      )),
      rail(stage(
        "Bind schemas to this diff",
        "det",
        "Zod enums for call_sites.field are built from diff.fields at runtime. Research schema is the full spec minus downstream_impacts. Written to state/<runId>/diff.json before any agent starts.",
        ["src/evidence.ts", "src/spec-schema.ts", "src/human-impact-schema.ts", "src/state.ts"],
      )),
      rail(stage(
        "Research fan-out",
        "det",
        "Across-repo concurrency from fleet.json (full | pool(n) | sequential). On 429/capacity: stop starting work, finish in-flight, retry leftovers down full → pool(2) → sequential. Visible as concurrency_degraded. Within a repo, the pair below is always parallel and is not this knob.",
        ["src/concurrency.ts", "src/pipeline.ts", "fleet.json"],
      )),
      rail(stage(
        "Restore baseline clone",
        "det",
        "Per consumer, before research: checkout the pinned start commit, reset --hard, clean -fdx. Prompt says do not reconstruct history; this script is the guarantee. Paid for by research that ran against an already-migrated tree.",
        ["src/clone.ts"],
      )),
      rail(stage(
        "Assemble and log prompts",
        "det",
        "Markdown templates with {{DIFF_SUMMARY}}, {{CHANGED_FIELDS}}, and an inline JSON schema ($refStrategy: none). The exact string sent to the agent is written to disk — what did the agent know has a replayable answer.",
        ["src/prompts.ts", "src/json-schema.ts", "prompts/research-agent.md", "prompts/human-impact-agent.md", "src/state.ts"],
      )),
      rail(`<p class="arch-aside">Same clone, two lenses, Promise.all — LEGOLAS ∥ BILBO</p>
        <div class="arch-pair">
          ${agentCard(
            "LEGOLAS · research",
            "Technical impact only: call sites, persistence, test impact, blockers, execution_grade. Output is JSON. Schema-invalid → retry once with the Zod error appended, then fail. Forbidden to design workarounds for blockers. Does not own downstream_impacts.",
            ["prompts/research-agent.md", "src/agents.ts", "src/run-agent.ts", "src/spec-schema.ts", "src/pipeline.ts"],
          )}
          ${agentCard(
            "BILBO · human-impact",
            "People in the blast radius. Reads prose docs, templates, runbooks. Findings need a verbatim quote; no quote → hypothesized_consumers. Does not set verdict. This is how a documented human procedure is found — a narrow lens, not luck.",
            ["prompts/human-impact-agent.md", "src/agents.ts", "src/run-agent.ts", "src/human-impact-schema.ts", "src/pipeline.ts"],
          )}
        </div>
        <p class="arch-aside">SDK seam is one function: runAgent in src/run-agent.ts (stub loads fixtures/stubs/; live is src/run-agent-live.ts). Both call sites live in src/agents.ts. JSON extraction: src/json-extract.ts.</p>`),
      rail(stage(
        "Hygiene inspect",
        "det",
        "After the pair: git porcelain. Tracked modifications become workspace_hygiene on the spec (gate-visible, verdict unchanged). Untracked test artifacts are cleaned, not warned. Tripwire over precision — the cheap dirty-workspace check found the real defect even when it was “wrong” about the agent.",
        ["src/clone.ts", "src/spec-schema.ts", "src/pipeline.ts"],
      )),
      rail(stage(
        "Merge + policies + Zod",
        "det",
        "spec.downstream_impacts = human result. One assignment, no merger LLM. Then policies.reduce (array is empty — the live-extension hook). Then migrationSpecSchemaFor(fields).parse: blocked iff organizational blocker, unaffected needs proof of absence, grade required only when affected. Human findings cannot flip verdict.",
        ["src/merge.ts", "src/policies.ts", "src/spec-schema.ts", "src/pipeline.ts"],
      )),
      rail(`<div class="arch-callout human">
          <div class="arch-callout-title">Human gate — last cheap sequential moment</div>
          <p>Reviews English + citations, not diffs. CLI is y/N (src/gate.ts). Dashboard is per-repo: approve/reject + optional note, grade override, model override (src/hold.ts, src/http.ts). An approved affected repo starts GIMLI immediately — other lanes can still be researching. Blocked never enters write even if someone types y. Note is stored as gate_note and is not injected into the write prompt — that is the reviewer-directives seam.</p>
        </div>
        ${files(["src/gate.ts", "src/hold.ts", "src/http.ts", "src/pipeline.ts", "public/app.js"])}`),
      rail(`<p class="arch-aside">Split by verdict — write fan-out only for approved + affected</p>
        <div class="arch-split">
          <div>
            <div class="arch-split-title">Affected → write</div>
            <p>Continues down this spine. Grade from the spec selects the write model.</p>
            ${files(["src/models.ts", "src/pipeline.ts"])}
          </div>
          <div>
            <div class="arch-split-title">Blocked → memo</div>
            <p>No code. escalation.json with quoted blockers. Terminal: blocked.</p>
            ${files(["src/fake-pr.ts", "src/pipeline.ts"])}
          </div>
          <div>
            <div class="arch-split-title">Unaffected → skip</div>
            <p>Terminal: unaffected. Hygiene on an unaffected spec still demands a human look (needsHumanDecision).</p>
            ${files(["src/spec-schema.ts", "src/pipeline.ts"])}
          </div>
        </div>`),
      rail(stage(
        "Prepare write workspace",
        "det",
        "Restore the pinned start commit again, branch to migration/spec-v3, drop a copy of the v3 OpenAPI for the agent (unstaged later so it never lands in the PR). Prompt rules are requests; this checkout is the guarantee.",
        ["src/clone.ts"],
      )),
      rail(agentCard(
        "GIMLI · write",
        "Implements the approved spec only — no refactors, no while I am here. If the spec is wrong against the tree, stop and report; do not invent migration #2. Inner loop: edit → test → retry, ≤3, inside this one run (prompt budget, not orchestrator). May regen goldens only when the output diff matches the spec, stated aloud. Never deletes tests. Never git push. Model comes from execution_grade via a config table, not from the agent naming one.",
        ["prompts/write-agent.md", "src/agents.ts", "src/run-agent.ts", "src/models.ts", "src/write-summary-schema.ts", "src/pipeline.ts"],
      )),
      rail(stage(
        "Outer escalate (one tier)",
        "det",
        "If write-summary is incomplete or last test_run still has failures, re-run once at the next model tier. Audit-trailed. Inner test-fix retries do not move the pointer. Reuses the dirty write tree (partial work kept) — that choice is not in the ADR.",
        ["src/models.ts", "src/write-summary-schema.ts", "src/pipeline.ts"],
      )),
      rail(stage(
        "Open PR or write-failed memo",
        "det",
        "Orchestrator commits, pushes the branch, opens a GitHub PR. Body is assembled from the spec + write summary (the compliance artifact). Never merges — CODEOWNERS + Bugbot are the second gate, native GitHub. Stub writes fake-pr.json instead. Agents are forbidden to gh/push.",
        ["src/pr.ts", "src/fake-pr.ts", "src/pipeline.ts"],
      )),
      rail(stage(
        "Closed terminals + report",
        "det",
        "migrated_verified | migrated_with_flags (HIGH human-impact) | blocked | failed | unaffected. notify() is invoked on every transition and is a no-op — Slack seam. Dashboard chip is LIVE vs STUB REHEARSAL, unmissable.",
        ["src/terminal-states.ts", "src/notifier.ts", "src/pipeline.ts", "public/app.js"],
      )),
      rail(`<div class="arch-callout warn">
          <div class="arch-callout-title">Not in the run — D19 probe (M4)</div>
          <p>Designed as a deterministic smoke-vs-baseline after the gate: point the fleet at v3, corroborate loud failures, grade the specs. Reading still leads, because some consumers fail silently. Dashboard reserves a GOLLUM pill. Do not claim this module exists.</p>
        </div>
        ${files(["README.md", "public/app.js", "docs/adr/DECISIONS.md"])}`, true),
    ].join("");
  }

  function pageHtml() {
    const seamCount = DECISIONS.filter((d) => d[1] === "seam").length;
    const rows = DECISIONS.map(
      ([id, layer, adr, decision, where, what]) => `<div class="arch-dec" data-layer="${layer}" data-id="${id}">
        <div class="arch-dec-meta"><span>${esc(adr)}</span><span class="arch-dec-layer">${esc(layer)}</span></div>
        <div class="arch-dec-title">${esc(decision)}</div>
        <div class="arch-dec-where">${esc(where)}</div>
        <p>${esc(what)}</p>
      </div>`,
    ).join("");
    return `
      <p class="arch-lede">Scroll the pipeline. Green bar is code. Blue is an agent. Amber is the human. Fan-out repeats the research pair and the write lane per consumer. Control flow lives in src/pipeline.ts.</p>
      <div class="arch-stats">
        <div><div class="arch-stat-n">1</div><div class="arch-stat-l">SDK seam</div></div>
        <div><div class="arch-stat-n">2</div><div class="arch-stat-l">Agents / repo</div></div>
        <div><div class="arch-stat-n">5</div><div class="arch-stat-l">Closed terminals</div></div>
        <div><div class="arch-stat-n">${seamCount}</div><div class="arch-stat-l">Seams / not-yet</div></div>
      </div>
      <div class="arch-legend">
        <span><i class="arch-kind det"></i> Deterministic</span>
        <span><i class="arch-kind agent"></i> Non-deterministic</span>
        <span><i class="arch-kind human"></i> Human</span>
      </div>
      <h2 class="arch-h">Pipeline</h2>
      <div class="arch-pipeline">${pipelineHtml()}</div>
      <h2 class="arch-h">Decision → code</h2>
      <div class="arch-filters" role="tablist">
        <button type="button" class="ghost on" data-arch-filter="all">All</button>
        <button type="button" class="ghost" data-arch-filter="guarantee">Code guarantees</button>
        <button type="button" class="ghost" data-arch-filter="schema">Schema checks</button>
        <button type="button" class="ghost" data-arch-filter="prompt">Prompt rules</button>
        <button type="button" class="ghost" data-arch-filter="seam">Seams &amp; gaps</button>
      </div>
      <div class="arch-decisions">${rows}</div>
      <h2 class="arch-h">Honest limits</h2>
      <details class="arch-details" open>
        <summary>Installed but unwired — 15-minute live extensions</summary>
        <ul>
          <li><code>policies.ts</code> — empty reduce. Hygiene flags from pipeline, not this array. A sensitive-data / path-allowlist policy is one object.</li>
          <li><code>HttpDecision.note</code> — reviewer directives. Wire as an attributed spec field; never edit agent text.</li>
          <li><code>notifier.ts</code> — already called on every terminal transition. Fill the body.</li>
          <li><code>fleet.json</code> row — add-a-repo is config, not a pipeline edit.</li>
        </ul>
      </details>
      <details class="arch-details">
        <summary>Designed, not in this repo</summary>
        <ul>
          <li>D19 probe (M4 / GOLLUM) — dashboard pill only. Corroborate, do not analyze.</li>
          <li>D14 baselines — ADR-only. Write agents may regen goldens; the orchestrator does not oracle-compare.</li>
          <li>Outer escalate reuses the dirty write tree after D32 restored it once. Choice, not documented.</li>
        </ul>
      </details>
    `;
  }

  let open = false;
  let filter = "all";

  function setOpen(next) {
    open = next;
    const root = document.getElementById("arch");
    const btn = document.getElementById("arch-btn");
    if (!root) return;
    root.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) {
      root.classList.add("open");
      document.body.classList.add("arch-open");
      const close = document.getElementById("arch-close");
      if (close) close.focus();
    } else {
      root.classList.remove("open");
      document.body.classList.remove("arch-open");
    }
    if (btn) {
      btn.classList.toggle("on", open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    }
  }

  function applyFilter(next) {
    filter = next;
    document.querySelectorAll("[data-arch-filter]").forEach((btn) => {
      btn.classList.toggle("on", btn.getAttribute("data-arch-filter") === filter);
    });
    document.querySelectorAll(".arch-dec").forEach((row) => {
      const layer = row.getAttribute("data-layer");
      row.classList.toggle("hidden", filter !== "all" && layer !== filter);
    });
  }

  return {
    isOpen: () => open,
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle() {
      setOpen(!open);
    },
    mount() {
      const body = document.getElementById("arch-body");
      if (!body) return;
      body.innerHTML = pageHtml();
      body.addEventListener("click", (ev) => {
        const btn = ev.target.closest("[data-arch-filter]");
        if (!btn) return;
        applyFilter(btn.getAttribute("data-arch-filter"));
      });
    },
  };
})();
