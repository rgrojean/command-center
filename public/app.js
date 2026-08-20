/* global document, fetch, FileReader, setInterval, clearInterval, URLSearchParams, ArchitectureDrawer */
const $ = (id) => document.getElementById(id);

const state = {
  view: "landing",
  meta: null,
  preview: null,
  previewError: "",
  files: { v2: null, v3: null, fleet: null },
  businessContext: "",
  mode: "stub",
  runId: null,
  board: null,
  allStreams: false,
  openStreams: {},
  releasing: false,
  killing: false,
  poll: null,
  pollMisses: 0,
  modal: null,
  authed: false,
  coachStep: null,
};

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fmtClock(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function evTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

async function api(path, opts) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function setModeChip(mode) {
  const el = $("mode-chip");
  const live = mode === "live";
  el.className = `mode-chip ${live ? "live" : "rehearsal"}`;
  el.textContent = live ? "LIVE" : "STUB REHEARSAL";
}

function setHeader({ run, clock, phase, phaseClass }) {
  $("stat-run").textContent = run || "—";
  $("stat-clock").textContent = clock || "00:00";
  $("stat-clock").className = phaseClass === "amber" ? "amber" : "";
  $("stat-phase").textContent = phase || "ENGAGE";
  $("stat-phase").className = phaseClass || "";
}

function previewBody() {
  const body = {};
  if (state.files.v2) body.v2 = state.files.v2;
  if (state.files.v3) body.v3 = state.files.v3;
  if (state.files.fleet) body.fleet = state.files.fleet;
  if (state.businessContext.trim()) body.business_context = state.businessContext.trim();
  return body;
}

function chipHtml(chip) {
  return `<div class="chip ${chip.tone}">${esc(chip.text)}</div>`;
}

function renderPreview() {
  const box = $("preview");
  if (state.previewError) {
    box.className = "preview-box err";
    box.innerHTML = `<div class="muted">Diff failed — Next stays disabled until the pair parses.</div><pre>${esc(state.previewError)}</pre>`;
    $("next-btn").disabled = true;
    return;
  }
  const p = state.preview;
  if (!p) {
    box.className = "preview-box";
    box.textContent = "Loading defaults…";
    $("next-btn").disabled = true;
    return;
  }
  box.className = "preview-box";
  const chips = (p.chips || []).map(chipHtml).join("");
  const fleet = (p.fleet?.repos || [])
    .map((r) => `${r.display_name} (${r.role}${r.port ? ` · :${r.port}` : ""})`)
    .join(" · ");
  box.innerHTML = `
    <div class="chips">${chips}</div>
    <div class="producer" style="margin-top:12px">producer: ${esc(p.producer?.slug)} · ${esc(p.fleet?.counts?.consumers)} consumers</div>
    <div class="muted" style="margin-top:8px">${esc(fleet)}</div>
    <pre>${esc(p.diff?.summary || "")}</pre>`;
  $("next-btn").disabled = false;
}

async function refreshPreview() {
  try {
    const p = await api("/api/preview", { method: "POST", body: JSON.stringify(previewBody()) });
    state.preview = p;
    state.previewError = "";
    if (!state.businessContext.trim() && p.fleet?.business_context) {
      state.businessContext = String(p.fleet.business_context);
    }
  } catch (err) {
    state.preview = null;
    state.previewError = err instanceof Error ? err.message : String(err);
  }
  renderPreview();
}

function bindFile(inputId, key) {
  $(inputId).addEventListener("change", () => {
    const file = $(inputId).files?.[0];
    if (!file) {
      state.files[key] = null;
      refreshPreview();
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      state.files[key] = String(reader.result);
      refreshPreview();
    };
    reader.readAsText(file);
  });
}

function coalesceAssistant(events) {
  const out = [];
  for (const e of events) {
    const prev = out[out.length - 1];
    if (
      prev &&
      String(prev.type || "").toLowerCase() === "assistant" &&
      String(e.type || "").toLowerCase() === "assistant"
    ) {
      out[out.length - 1] = { ...prev, message: `${prev.message || ""}${e.message || ""}` };
    } else {
      out.push(e);
    }
  }
  return out;
}

function agentEvents(lane, stage) {
  return coalesceAssistant((lane.events || []).filter((e) => e.stage === stage));
}

function lastTick(events, idle) {
  if (!events.length) return idle;
  if (assistantJson(events)) return "result · json result";
  const last = events[events.length - 1];
  const kind = kindLabel(last.type).toLowerCase();
  let text = last.message || "";
  if (String(last.type || "").toLowerCase() === "assistant") {
    text = splitAssistant(text).prose || text;
  }
  text = text.replace(/\s+/g, " ").trim();
  return `${kind} ${text}`.slice(0, 72);
}

function lastTickHtml(lane, stage, events, idle) {
  if (!events.length) return esc(idle);
  if (assistantJson(events)) {
    return `result · <button class="json-link" type="button" data-json-slug="${esc(lane.slug)}" data-json-stage="${esc(stage)}" data-json-idx="all">json result</button>`;
  }
  return esc(lastTick(events, idle));
}

function kindLabel(type) {
  const t = String(type || "note").toLowerCase();
  if (t === "killed") return "KILL";
  if (t === "assistant") return "OUT";
  if (t === "tool_call") return "TOOL";
  if (t === "judgment_call") return "JUDGMENT";
  if (t === "schema_retry") return "RETRY";
  if (t === "start") return "START";
  if (t === "start_pin" || t === "starting_ref") return "PIN";
  if (t === "pair_failed") return "FAILED";
  if (t === "stub") return "STUB";
  if (t === "reused") return "REUSED";
  return t.toUpperCase().slice(0, 8);
}

function splitAssistant(message) {
  const raw = String(message || "");
  const json = jsonPayload(raw);
  if (!json) return { prose: raw, json: null };
  const obj = raw.indexOf("{");
  const arr = raw.indexOf("[");
  let start = -1;
  if (obj >= 0 && (arr < 0 || obj < arr)) start = obj;
  else if (arr >= 0) start = arr;
  const prose = start > 0 ? raw.slice(0, start).trim() : "";
  return { prose, json };
}

function jsonPayload(message) {
  const raw = String(message || "").trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? raw).trim();
  const obj = candidate.indexOf("{");
  const arr = candidate.indexOf("[");
  let start = -1;
  if (obj >= 0 && (arr < 0 || obj < arr)) start = obj;
  else if (arr >= 0) start = arr;
  if (start < 0) return null;
  const close = candidate[start] === "{" ? "}" : "]";
  const end = candidate.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.stringify(JSON.parse(candidate.slice(start, end + 1)), null, 2);
  } catch {
    return null;
  }
}

function assistantJson(events) {
  const blobs = (events || [])
    .filter((e) => String(e.type || "").toLowerCase() === "assistant")
    .map((e) => e.message || "");
  if (!blobs.length) return null;
  for (let i = blobs.length - 1; i >= 0; i--) {
    const one = jsonPayload(blobs[i]);
    if (one) return one;
  }
  return jsonPayload(blobs.join(""));
}

function highlightJson(pretty) {
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|\b(true|false|null)\b/g;
  let html = "";
  let last = 0;
  const src = String(pretty || "");
  for (const match of src.matchAll(re)) {
    const idx = match.index ?? 0;
    html += esc(src.slice(last, idx));
    const [, str, colon, num, bool] = match;
    if (str) html += colon ? `<span class="jk">${esc(str)}</span>${esc(colon)}` : `<span class="js">${esc(str)}</span>`;
    else if (num) html += `<span class="jn">${esc(num)}</span>`;
    else if (bool) html += `<span class="jb">${esc(bool)}</span>`;
    last = idx + match[0].length;
  }
  return html + esc(src.slice(last));
}

function citeLine(ev) {
  if (!ev) return "";
  const loc = `${ev.file || ""}${ev.line ? `:${ev.line}` : ""}`;
  const quote = ev.quote ? `“${ev.quote}”` : "";
  return [loc, quote].filter(Boolean).join(" — ");
}

function dossSec(title, inner) {
  if (!inner) return "";
  return `<div class="doss-sec"><div class="doss-h">${esc(title)}</div>${inner}</div>`;
}

function noneItem(label) {
  return `<div class="muted">${esc(label)}</div>`;
}

function agentState(lane, stage, phase) {
  const events = agentEvents(lane, stage);
  const hasSpec = !!lane.spec;
  const writing = (lane.stages || []).includes("write") || (lane.stages || []).includes("fake_pr") || (lane.stages || []).includes("pr");
  if (stage === "write") {
    if (lane.terminal && writing) return "done";
    if (phase === "write" && lane.gate === "approved" && !lane.terminal) return events.length ? "running" : "queued";
    if (writing && !lane.terminal) return "running";
    return "idle";
  }
  if (hasSpec) return "done";
  if (events.length && (phase === "research" || phase === "gate")) return "running";
  if (phase === "research") return events.length ? "running" : "queued";
  return "idle";
}

function edgeClass(mode, color) {
  if (mode === "flow") return `bar flow${color === "green" ? " green" : ""}`;
  if (mode === "full") return `bar full`;
  return `bar dry`;
}

function edgeStyle(mode, color) {
  if (mode === "full") return `background:${color}`;
  return "";
}

function stampStyle(terminal) {
  const map = {
    migrated_verified: ["#58c98a", "-1.3"],
    migrated_with_flags: ["#58c98a", "1.4"],
    blocked: ["#e05a4f", "1.6"],
    failed: ["#e05a4f", "-1"],
    unaffected: ["#727d84", "-1"],
  };
  const [c, tilt] = map[terminal] || ["#727d84", "0"];
  return `color:${c};border-color:${c};transform:rotate(${tilt}deg)`;
}

function evidenceHtml(lane) {
  const spec = lane.spec;
  if (!spec) return noneItem("no spec yet");
  const sites = (spec.call_sites || [])
    .map(
      (c) =>
        `<div class="doss-item"><span class="site">${esc(c.file)}:${esc(c.line)}</span> <span class="chip verdict ${c.field ? "amber" : "slate"}">${esc(c.field || "")}</span><p>${esc(c.usage)}</p></div>`,
    )
    .join("");
  const persistence = (spec.persistence || [])
    .map((p) => {
      return `<div class="doss-item"><p><strong>${esc(p.store)}</strong></p>
        <div class="cite">DDL ${esc(citeLine(p.ddl_evidence))}</div>
        <div class="cite">write ${esc(citeLine(p.write_path_evidence))}</div></div>`;
    })
    .join("");
  const blockers = (spec.blockers || [])
    .map(
      (b) =>
        `<div class="doss-item"><span class="chip verdict ${b.class === "organizational" ? "red" : "amber"}">${esc(b.class)}</span><p>${esc(b.summary)}</p><div class="quote">“${esc(b.evidence?.quote || "")}”</div><div class="cite">${esc(citeLine(b.evidence))}</div></div>`,
    )
    .join("");
  const changes = (spec.required_changes || [])
    .map(
      (c) =>
        `<div class="doss-item"><p>[${esc(c.id)}] ${esc(c.description)}</p><div class="cite">${esc((c.files || []).join(", "))}${c.evidence ? ` · ${esc(citeLine(c.evidence))}` : ""}</div></div>`,
    )
    .join("");
  const tests = [
    ...(spec.test_impact?.existing_tests || []).map(
      (t) =>
        `<div class="doss-item"><span class="chip verdict ${t.will_break ? "red" : "slate"}">${t.will_break ? "BREAKS" : "ok"}</span><p>${esc(t.name)} — ${esc(t.why)}</p><div class="cite">${esc(t.file)}${t.evidence ? ` · ${esc(citeLine(t.evidence))}` : ""}</div></div>`,
    ),
    ...(spec.test_impact?.recommended_new_tests || []).map(
      (t) =>
        `<div class="doss-item"><span class="chip verdict amber">NEW</span><p>${esc(t.name)}</p><div class="cite">fails first: ${esc(t.fails_first_because)}</div></div>`,
    ),
  ].join("");
  const down = spec.downstream_impacts;
  const findings = (down?.findings || [])
    .map(
      (f) =>
        `<div class="doss-item"><span class="chip verdict ${f.rating === "HIGH" ? "red" : f.rating === "MED" ? "amber" : "slate"}">${esc(f.rating)}</span> <span class="cite">${esc(f.kind)}</span><p>${esc(f.summary)}</p><div class="quote">“${esc(f.evidence?.quote || "")}”</div><div class="cite">${esc(citeLine(f.evidence))}</div></div>`,
    )
    .join("");
  const hypo = (down?.hypothesized_consumers || [])
    .map(
      (h) =>
        `<div class="doss-item"><p>${esc(h.hypothesis)}</p><div class="cite">trail: ${esc(h.evidence_trail)} · confirm by: ${esc(h.confirm_by)} · conf ${esc(h.confidence)}</div></div>`,
    )
    .join("");
  const flags = (down?.flags || [])
    .map((f) => `<div class="doss-item"><span class="chip verdict slate">${esc(f.kind)}</span><p>${esc(f.summary)}</p></div>`)
    .join("");
  const gaps = (spec.production_verification?.gaps || [])
    .map(
      (g) =>
        `<div class="doss-item"><p>${esc(g.deficiency)}</p><p>→ ${esc(g.recommended_instrumentation)}</p><div class="cite">${esc(citeLine(g.evidence))}${g.phi_safe ? " · PHI-safe" : ""}</div></div>`,
    )
    .join("");
  const proof = (spec.evidence || [])
    .map((e) => `<div class="doss-item"><div class="quote">“${esc(e.quote || "")}”</div><div class="cite">${esc(citeLine(e))}</div></div>`)
    .join("");
  return [
    dossSec(
      "VERDICT",
      `<p>${esc((spec.verdict || "").toUpperCase())}${spec.execution_grade ? ` · ${esc(spec.execution_grade)}` : ""} · confidence ${esc(spec.confidence?.score ?? "—")}</p>
       ${spec.grade_reasoning ? `<p>${esc(spec.grade_reasoning)}</p>` : ""}
       ${spec.confidence?.rationale ? `<div class="cite">${esc(spec.confidence.rationale)}</div>` : ""}`,
    ),
    dossSec("CALL SITES", sites || noneItem("none")),
    dossSec("PERSISTENCE", persistence || noneItem("none")),
    dossSec("BLOCKERS", blockers || noneItem("none")),
    dossSec("REQUIRED CHANGES", changes || noneItem("none")),
    dossSec("TEST IMPACT", tests || noneItem("none")),
    dossSec(
      "DOWNSTREAM",
      `${down ? `<p>overall ${esc(down.overall_rating)} — ${esc(down.rating_rationale)}</p><div class="cite">rating would change if ${esc(down.rating_would_change_if)}</div>` : ""}
       ${findings}${hypo}${flags}` || noneItem("none"),
    ),
    dossSec("PRODUCTION VERIFICATION", gaps || noneItem("none")),
    spec.verdict === "unaffected" ? dossSec("PROOF OF ABSENCE", proof || noneItem("none")) : "",
    spec.workspace_hygiene
      ? dossSec(
          "WORKSPACE HYGIENE",
          `<p>Research modified tracked files. Policy signal — verdict unchanged; human decides.</p>
           <div class="cite">${esc((spec.workspace_hygiene.files || []).join(" · "))}</div>
           <pre class="json-pre">${esc(spec.workspace_hygiene.diff || "")}</pre>`,
        )
      : "",
  ].join("");
}

function closeDossier() {
  state.modal = null;
  const el = $("dossier");
  el.classList.add("hidden");
  $("dossier-body").innerHTML = "";
  $("dossier-copy").classList.remove("copied");
}

function dossierCopyText() {
  const modal = state.modal;
  if (!modal) return "";
  if (modal.type === "prompt") return modal.text || "";
  if (modal.type === "json") return modal.json || "";
  return $("dossier-body").innerText || "";
}

async function copyDossier() {
  const text = dossierCopyText();
  if (!text || text === "loading…") return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  const btn = $("dossier-copy");
  btn.classList.add("copied");
  btn.title = "Copied";
  window.setTimeout(() => {
    btn.classList.remove("copied");
    btn.title = "Copy contents";
  }, 1200);
}

function openDossier(modal) {
  state.modal = modal;
  renderDossier();
}

function renderDossier() {
  const el = $("dossier");
  const modal = state.modal;
  if (!modal) {
    el.classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");
  if (modal.type === "json") {
    $("dossier-kicker").textContent = modal.kicker || "AGENT OUTPUT";
    $("dossier-title").textContent = modal.title;
    $("dossier-sub").textContent = modal.sub || "";
    $("dossier-body").innerHTML = `<pre class="json-pre">${highlightJson(modal.json)}</pre>`;
    return;
  }
  if (modal.type === "prompt") {
    $("dossier-kicker").textContent = modal.kicker || "PROMPT";
    $("dossier-title").textContent = modal.title;
    $("dossier-sub").textContent = modal.sub || "";
    $("dossier-body").innerHTML = `<pre class="json-pre">${esc(modal.text || "")}</pre>`;
    return;
  }
  const lane = (state.board?.lanes || []).find((l) => l.slug === modal.slug);
  $("dossier-kicker").textContent = "GANDALF · EVIDENCE";
  $("dossier-title").textContent = lane?.display_name || modal.slug;
  $("dossier-sub").textContent = lane ? `${lane.slug}${lane.verdict ? ` · ${lane.verdict}` : ""}` : "";
  $("dossier-body").innerHTML = lane ? evidenceHtml(lane) : noneItem("lane not found");
}

function renderAgent(lane, callsign, stage, model) {
  const key = `${lane.slug}-${callsign}`;
  const st = agentState(lane, stage, state.board?.phase || "research");
  const events = agentEvents(lane, stage);
  const expanded = !!(state.allStreams || state.openStreams[key]) && st !== "idle";
  const running = st === "running";
  const done = st === "done";
  const color = running ? "amber pulse" : done ? "green" : "";
  const box = running ? "agent run" : done ? "agent done" : "agent";
  const tickColor = running ? "amber" : st === "idle" ? "muted" : "";
  const meta = running ? "live" : done ? "done" : "queued";
  const idleTick =
    st === "done" ? "done" : stage === "write" ? "waiting for release" : "waiting for fan-out";
  let jsonLinked = false;
  const streamRows = [];
  events.forEach((e, i) => {
    const type = String(e.type || "").toLowerCase();
    const row = (kind, kclass, body) =>
      `<div class="ev"><span class="t">${esc(evTime(e.ts))}</span><span class="k ${kclass}">${esc(kind)}</span>${body}</div>`;
    if (type === "assistant") {
      const { prose, json } = splitAssistant(e.message);
      if (prose) streamRows.push(row("OUT", "", `<span class="txt">${esc(prose)}</span>`));
      if (json) {
        jsonLinked = true;
        streamRows.push(
          row(
            "RESULT",
            "DONE",
            `<button class="json-link" type="button" data-json-slug="${esc(lane.slug)}" data-json-stage="${esc(stage)}" data-json-idx="${i}">json result</button>`,
          ),
        );
      }
      return;
    }
    const kind = kindLabel(e.type);
    const json = jsonPayload(e.message);
    const kclass =
      kind === "KILL"
        ? "KILL"
        : kind === "RESULT" || (kind === "STUB" && done)
          ? "DONE"
          : kind === "NOTE" || kind === "JUDGMENT"
            ? "NOTE"
            : "";
    const text = json
      ? `<button class="json-link" type="button" data-json-slug="${esc(lane.slug)}" data-json-stage="${esc(stage)}" data-json-idx="${i}">json result</button>`
      : `<span class="txt">${esc(e.message || "")}</span>`;
    if (json) jsonLinked = true;
    streamRows.push(row(kind, kclass, text));
  });
  if (!jsonLinked && assistantJson(events)) {
    const last = events[events.length - 1];
    streamRows.push(
      `<div class="ev"><span class="t">${esc(evTime(last?.ts))}</span><span class="k DONE">RESULT</span><button class="json-link" type="button" data-json-slug="${esc(lane.slug)}" data-json-stage="${esc(stage)}" data-json-idx="all">json result</button></div>`,
    );
  }
  const stream = streamRows.join("");
  const hasPrompt = !!(lane.prompts && lane.prompts[stage]);
  const promptBtn = hasPrompt
    ? `<button class="prompt-link" type="button" data-prompt-slug="${esc(lane.slug)}" data-prompt-stage="${esc(stage)}">prompt</button>`
    : "";
  const sub =
    !expanded || hasPrompt
      ? `<div class="agent-sub">${expanded ? "" : `<div class="tick ${tickColor}">${lastTickHtml(lane, stage, events, idleTick)}</div>`}${promptBtn}</div>`
      : "";
  return `<div class="${box}">
    <button class="agent-head" data-toggle="${esc(key)}" type="button">
      <div class="dot ${color}"></div>
      <span class="callsign">${esc(callsign)}</span>
      <span class="model model-id" title="${esc(model || "—")}">${esc(model || "—")}</span>
      <span class="model meta-state ${running ? "amber" : ""}">${meta}</span>
      <span class="caret">${expanded ? "▾" : "▸"}</span>
    </button>
    ${sub}
    ${expanded ? `<div class="stream">${stream}${running ? `<div class="live-line"><span class="dot amber pulse"></span><span>streaming</span></div>` : ""}</div>` : ""}
  </div>`;
}

function decisionLabel(lane, holding) {
  if (!lane.spec) return null;
  if (holding && lane.needs_decision) return null;
  if (lane.verdict === "unaffected") {
    if (lane.gate === "rejected") return { text: "REJECTED · NO WRITE", cls: "decision", color: "#eb8d83" };
    return { text: "AUTO-PASS · NO WRITE", cls: "decision", color: "#8b959b" };
  }
  if (lane.verdict === "blocked") return { text: "YOU SHALL NOT PASS", cls: "decision", color: "#eb8d83" };
  if (lane.gate === "approved") return { text: holding ? "APPROVED · QUEUED" : "APPROVED", cls: "decision", color: "#58c98a" };
  if (lane.gate === "rejected") return { text: "REJECTED", cls: "decision", color: "#eb8d83" };
  return null;
}

function noWriteLabel(lane, phase) {
  if (lane.verdict === "blocked") return "no write · escalation";
  if (lane.verdict === "unaffected") return "nothing to migrate";
  if (lane.gate === "rejected") return "write cancelled";
  if (phase === "gate" || phase === "research") return "awaiting gate";
  return "awaiting gate";
}

function renderLane(lane, ctx) {
  const { phase, holding, released } = ctx;
  const researchOn = agentState(lane, "research", phase) === "running" || agentState(lane, "human_impact", phase) === "running";
  const researchDone = !!lane.spec;
  const writeSt = agentState(lane, "write", phase);
  const writeOn = writeSt === "running";
  const terminal = lane.terminal;
  const decided = decisionLabel(lane, holding);
  const decidable = holding && lane.needs_decision;
  const gandalf = lane.gandalf === "HELD" ? "GANDALF · HELD" : lane.gandalf === "PASS" ? "GANDALF · PASS" : "";
  const verdict = lane.verdict ? lane.verdict.toUpperCase() : "";
  const vTone = lane.verdict === "blocked" ? "red" : lane.verdict === "affected" ? "amber" : "slate";
  const repoDot = researchDone ? (lane.verdict === "blocked" ? "red" : "green") : researchOn ? "amber pulse" : "";
  const kindPort = lane.port ? `${lane.kind} · :${lane.port}` : lane.kind;
  const pin = lane.starting_sha
    ? lane.starting_sha.slice(0, 7)
    : lane.start_ref || "";
  const grade = lane.execution_grade;
  const gradeModel = lane.write_model || (grade && ctx.models?.write?.[grade]) || "";
  const gradeHtml = grade
    ? `<div class="grade-line"><span>${esc(grade)}</span><span class="muted">→ ${esc(gradeModel || "—")}</span></div>`
    : "";
  const hasGimli = released && lane.gate === "approved" && lane.verdict === "affected";
  const stubMode = researchOn ? "flow" : researchDone || phase !== "research" ? "full" : "dry";
  const researchEdge = researchOn ? "flow" : researchDone ? "full" : "dry";
  const gateEdge = researchDone && holding && lane.needs_decision ? "flow" : researchDone ? "full" : "dry";
  const writeEdge = writeOn ? "flow" : writeSt === "done" || terminal ? "full" : "dry";
  const outEdge = terminal ? "full" : "dry";
  const outColor = lane.verdict === "blocked" || terminal === "failed" ? "#e05a4f" : "#58c98a";
  const pr = lane.pr;
  let prHtml = "";
  if (terminal && pr) {
    const label = pr.stub ? `stub PR ↗` : pr.number ? `PR #${pr.number} ↗` : "PR ↗";
    prHtml = `<div class="pr-line"><a href="${esc(pr.url)}" target="_blank" rel="noreferrer">${esc(label)}</a></div>`;
  } else if (terminal && lane.escalation) {
    prHtml = `<div class="pr-line red">escalated</div>`;
  } else if (terminal && lane.verdict === "unaffected") {
    prHtml = `<div class="pr-line muted">no action</div>`;
  }

  return `<div class="lane ${researchOn || writeOn ? "hot" : ""}">
    <div class="stub"><div class="${edgeClass(stubMode)}" style="${edgeStyle(stubMode, "#e0a437")}"></div></div>
    <div class="repo-cell">
      <div class="repo-name"><div class="dot ${repoDot}"></div><span>${esc(lane.display_name)}</span></div>
      <span class="meta">${esc(kindPort)}</span>
      <span class="slug">${esc(lane.slug)}${pin ? ` · ${esc(pin)}` : ""}</span>
    </div>
    <div class="edge"><div class="${edgeClass(researchEdge)}" style="${edgeStyle(researchEdge, researchOn ? "#e0a437" : "#58c98a")}"></div></div>
    <div class="research-cell">
      ${renderAgent(lane, "LEGOLAS", "research", lane.research_model)}
      ${renderAgent(lane, "BILBO", "human_impact", lane.human_impact_model)}
    </div>
    <div class="edge"><div class="${edgeClass(gateEdge)}" style="${edgeStyle(gateEdge, lane.needs_decision ? "#e0a437" : "#58c98a")}"></div></div>
    <div class="gate-cell ${holding ? "hold" : ""}">
      ${
        researchDone
          ? `<div class="gate-stack">
              <div class="gate-row">
                <span class="chip verdict ${vTone}">${esc(verdict)}</span>
                ${gandalf ? `<span class="chip verdict ${lane.gandalf === "HELD" ? "red" : "slate"}">${esc(gandalf)}</span>` : ""}
                ${lane.spec?.workspace_hygiene ? `<span class="chip verdict amber">CLONE EDITED</span>` : ""}
              </div>
              ${gradeHtml}
              <button class="ev-btn" data-evidence="${esc(lane.slug)}" type="button">▸ EVIDENCE</button>
              ${
                decidable
                  ? `<div class="actions">
                      <button class="approve" data-decide="${esc(lane.slug)}" data-val="approved" type="button">APPROVE</button>
                      <button class="reject" data-decide="${esc(lane.slug)}" data-val="rejected" type="button">REJECT</button>
                    </div>`
                  : decided
                    ? `<div class="decision" style="color:${decided.color}">${esc(decided.text)}</div>`
                    : ""
              }
            </div>`
          : `<div class="muted">awaiting research</div>`
      }
    </div>
    <div class="edge"><div class="${edgeClass(writeEdge)}" style="${edgeStyle(writeEdge, writeOn ? "#e0a437" : "#58c98a")}"></div></div>
    <div class="write-cell">
      ${
        hasGimli
          ? renderAgent(lane, "GIMLI", "write", lane.write_model)
          : `<div class="muted">${esc(noWriteLabel(lane, phase))}</div>`
      }
    </div>
    <div class="edge"><div class="${edgeClass(outEdge)}" style="${edgeStyle(outEdge, outColor)}"></div></div>
    <div class="report-cell">
      ${terminal ? `<div class="stamp" style="${stampStyle(terminal)}">${esc(String(terminal).toUpperCase())}</div>${prHtml}` : `<div class="muted">—</div>`}
    </div>
  </div>`;
}

function idleLanesFromPreview() {
  const repos = (state.preview?.fleet?.repos || []).filter((r) => r.role === "consumer");
  return repos.map((r) => ({
    slug: r.slug,
    display_name: r.display_name,
    kind: r.kind,
    port: r.port,
    events: [],
    stages: [],
    gandalf: "PENDING",
  }));
}

function phaseLabel(phase, holding) {
  if (!phase || phase === "research") return "RESEARCH";
  if (phase === "gate") return holding ? "GATE · HOLDING" : "GATE";
  if (phase === "write") return "WRITE";
  if (phase === "done") return "REPORT";
  if (phase === "failed") return "FAILED";
  return String(phase).toUpperCase();
}

function concHeadNote(c) {
  if (!c?.note) return "";
  const body = c.degraded
    ? `<span class="degrade">${esc(c.note)}</span>`
    : esc(c.note);
  return ` · ${body}`;
}

function researchHeadSub(board) {
  return `LEGOLAS · BILBO${concHeadNote(board?.concurrency?.research)}`;
}

function writeHeadSub(board) {
  return `GIMLI${concHeadNote(board?.concurrency?.write)}`;
}

function progressFor(phase, holding) {
  if (phase === "research") return { pct: 18, hold: false };
  if (phase === "gate") return { pct: 48, hold: holding };
  if (phase === "write") return { pct: 78, hold: false };
  if (phase === "done") return { pct: 100, hold: false };
  return { pct: 0, hold: false };
}

function renderBoard() {
  const board = state.board;
  const preview = state.preview;
  const phase = board?.phase || "idle";
  const holding = !!board?.holding;
  const released = phase === "write" || phase === "done";
  const chips = board?.chips?.length ? board.chips : preview?.chips || [];
  const producer = board?.producer || preview?.producer || {};
  const counts = board?.fleet_count || preview?.fleet?.counts || {};
  const lanes = board?.lanes?.length ? board.lanes : idleLanesFromPreview();
  const live = (board?.mode || state.mode) === "live";
  setModeChip(live ? "live" : "stub");
  setHeader({
    run: board?.runId || "pending",
    clock: fmtClock(board?.elapsed_s || 0),
    phase: state.view === "board" ? (phase === "idle" ? "READY" : phaseLabel(phase, holding)) : "ENGAGE",
    phaseClass: holding ? "amber" : phase === "done" ? "green" : "",
  });

  const colOn = {
    FLEET: phase !== "idle",
    RESEARCH: phase === "research" || phase === "gate" || released,
    GATE: phase === "gate" || released,
    WRITE: released,
    REPORT: phase === "done",
  };
  const heads = [
    ["FLEET", "repos under watch", 186 + 44, true],
    ["RESEARCH", researchHeadSub(board), 322 + 40, false],
    ["GATE", "GANDALF · human", 260 + 40, false],
    ["WRITE", writeHeadSub(board), 322 + 40, false],
    ["REPORT", "PRs · escalations", 210, false],
  ]
    .map(([label, sub, w], i) => {
      const on = i === 0 ? true : colOn[label];
      const gateHold = label === "GATE" && holding;
      return `<div class="col-head" style="width:${w}px;padding-left:${label === "FLEET" ? "44px" : "0"}">
        <div class="lbl"><div class="dot ${gateHold ? "amber pulse" : on ? "green" : ""}"></div><span class="${on ? "" : "off"}">${label}</span></div>
        <div class="sub">${sub}</div>
      </div>`;
    })
    .join("");

  const ctx = { phase: phase === "idle" ? "research" : phase, holding, released, models: board?.models };
  const laneHtml = lanes.map((l) => renderLane(l, ctx)).join("");
  $("canvas").innerHTML = `
    <div class="diff-panel">
      <div class="diff-head"><div class="dot ${chips.length ? "green" : "amber pulse"}"></div>SPEC DIFF</div>
      <div class="pair">patient.v2 → v3</div>
      <div class="chips">${chips.map(chipHtml).join("") || `<div class="muted">awaiting pair</div>`}</div>
      <div class="producer">producer: ${esc(producer.slug || "identity_service")}</div>
      <div class="fleet-foot">FLEET · ${esc(counts.repos ?? "—")} repos<br/>${esc(counts.producers ?? 1)} producer · ${esc(counts.consumers ?? lanes.length)} consumers</div>
    </div>
    <div class="trunk"><div class="trunk-line ${chips.length ? "on" : ""}"></div></div>
    <div class="lanes">
      <div class="col-heads">${heads}</div>
      <div class="lanes-body">${laneHtml}</div>
      <div class="deferred">
        <div class="pill"><span class="cs">GOLLUM</span><span class="tx">v3 preflight probe · smoke vs baseline</span><span class="tag">M4</span></div>
        <div class="pill"><span class="cs">REVIEW FEEDBACK</span><span class="tx">PR comments loop back into spec revision</span><span class="tag">ROADMAP</span></div>
      </div>
    </div>`;

  const prog = progressFor(phase, holding);
  $("fill").style.width = `${prog.pct}%`;
  $("fill").className = `fill${prog.hold ? " hold" : ""}`;
  const marks = ["DIFF", "RESEARCH", "GATE", "WRITE", "REPORT"];
  const reached = {
    DIFF: true,
    RESEARCH: phase !== "idle",
    GATE: phase === "gate" || released,
    WRITE: released,
    REPORT: phase === "done",
  };
  $("marks").innerHTML = marks
    .map((m) => {
      const on = reached[m];
      const cls = m === "GATE" && holding ? "amber" : on ? "green" : "off";
      return `<span class="${cls}">${m}</span>`;
    })
    .join("");

  $("streams-btn").classList.toggle("hidden", state.view !== "board");
  $("streams-btn").classList.toggle("on", state.allStreams);
  $("streams-btn").textContent = state.allStreams ? "COLLAPSE ALL STREAMS" : "EXPAND ALL STREAMS";

  const runBtn = $("run-btn");
  const killed = /killed/i.test(board?.error || "");
  runBtn.className = holding ? "held" : "primary";
  if (holding) {
    runBtn.textContent = "HELD AT GATE";
    runBtn.disabled = true;
  } else if (phase === "write") {
    runBtn.textContent = "WRITING";
    runBtn.disabled = true;
  } else if (phase === "done") {
    runBtn.textContent = "COMPLETE";
    runBtn.disabled = true;
  } else if (phase === "failed") {
    runBtn.textContent = killed ? "KILLED" : "FAILED";
    runBtn.disabled = true;
  } else {
    runBtn.textContent = "RUN";
    runBtn.disabled = state.view !== "board" || !!state.runId;
  }

  const killBtn = $("kill-btn");
  const canKill = !!board?.controlling && phase !== "done" && phase !== "failed";
  killBtn.disabled = !canKill || state.killing;

  if (holding) $("hint").textContent = "decide every spec to release";
  else if (phase === "failed") $("hint").textContent = killed ? "killed · agents cancelled" : board?.error || "run failed";
  else if (phase === "done") $("hint").textContent = "run complete";
  else if (phase === "write") $("hint").textContent = "GIMLI executing approved specs";
  else if (state.view === "board" && !state.runId) $("hint").textContent = "fleet loaded · click RUN";
  else $("hint").textContent = "streams collapsed · click a callsign";

  bindBoardClicks();
  if (state.modal) renderDossier();
}

function bindBoardClicks() {
  $("canvas").onclick = async (ev) => {
    const jsonBtn = ev.target.closest("[data-json-slug]");
    if (jsonBtn) {
      ev.stopPropagation();
      const slug = jsonBtn.dataset.jsonSlug;
      const stage = jsonBtn.dataset.jsonStage;
      const idx = jsonBtn.dataset.jsonIdx;
      const lane = (state.board?.lanes || []).find((l) => l.slug === slug);
      const events = lane ? agentEvents(lane, stage) : [];
      const event = idx === "all" ? null : events[Number(idx)];
      const pretty = idx === "all" ? assistantJson(events) : jsonPayload(event?.message);
      if (!pretty) return;
      const callsign = stage === "write" ? "GIMLI" : stage === "human_impact" ? "BILBO" : "LEGOLAS";
      openDossier({
        type: "json",
        kicker: `${callsign} · ${lane?.display_name || slug}`,
        title: "JSON RESULT",
        sub: `${slug} · ${stage}${event ? ` · ${kindLabel(event.type)}` : ""}`,
        json: pretty,
      });
      return;
    }
    const promptBtn = ev.target.closest("[data-prompt-slug]");
    if (promptBtn) {
      ev.stopPropagation();
      const slug = promptBtn.dataset.promptSlug;
      const stage = promptBtn.dataset.promptStage;
      const lane = (state.board?.lanes || []).find((l) => l.slug === slug);
      const callsign = stage === "write" ? "GIMLI" : stage === "human_impact" ? "BILBO" : "LEGOLAS";
      openDossier({
        type: "prompt",
        kicker: `${callsign} · ${lane?.display_name || slug}`,
        title: "PROMPT",
        sub: `${slug} · ${stage}`,
        text: "loading…",
      });
      api(`/api/runs/${state.runId}/specs/${slug}/prompt?stage=${encodeURIComponent(stage)}`)
        .then((body) => {
          if (state.modal?.type !== "prompt") return;
          openDossier({
            type: "prompt",
            kicker: `${callsign} · ${lane?.display_name || slug}`,
            title: "PROMPT",
            sub: `${slug} · ${stage}`,
            text: body.prompt,
          });
        })
        .catch((err) => {
          if (state.modal?.type !== "prompt") return;
          openDossier({
            type: "prompt",
            kicker: `${callsign} · ${lane?.display_name || slug}`,
            title: "PROMPT",
            sub: `${slug} · ${stage}`,
            text: err instanceof Error ? err.message : String(err),
          });
        });
      return;
    }
    const t = ev.target.closest("[data-toggle],[data-evidence],[data-decide]");
    if (!t) return;
    if (t.dataset.toggle) {
      state.openStreams[t.dataset.toggle] = !state.openStreams[t.dataset.toggle];
      renderBoard();
      return;
    }
    if (t.dataset.evidence) {
      openDossier({ type: "evidence", slug: t.dataset.evidence });
      return;
    }
    if (t.dataset.decide && state.runId) {
      const slug = t.dataset.decide;
      const decision = t.dataset.val;
      t.disabled = true;
      try {
        await api(`/api/runs/${state.runId}/specs/${slug}/decision`, {
          method: "POST",
          body: JSON.stringify({ decision }),
        });
        await pollOnce();
      } catch (err) {
        $("hint").textContent = err instanceof Error ? err.message : String(err);
      }
    }
  };
}

async function pollOnce() {
  if (!state.runId) return;
  const board = await api(`/api/runs/${state.runId}`);
  state.pollMisses = 0;
  state.board = board;
  if (board.can_release && !state.releasing) {
    state.releasing = true;
    try {
      await api(`/api/runs/${state.runId}/release`, { method: "POST", body: "{}" });
    } catch {
      /* already released or aborted */
    } finally {
      state.releasing = false;
    }
    state.board = await api(`/api/runs/${state.runId}`);
  }
  renderBoard();
  if (board.phase === "done" || board.phase === "failed") stopPoll();
}

function startPoll() {
  stopPoll();
  state.poll = setInterval(() => {
    pollOnce().catch((err) => {
      state.pollMisses = (state.pollMisses || 0) + 1;
      if (state.pollMisses < 8) return;
      $("hint").textContent = err instanceof Error ? err.message : String(err);
    });
  }, 1000);
  pollOnce().catch(() => {});
}

function stopPoll() {
  if (state.poll) clearInterval(state.poll);
  state.poll = null;
}

function showLanding() {
  state.view = "landing";
  state.runId = null;
  state.board = null;
  state.releasing = false;
  state.killing = false;
  closeDossier();
  stopPoll();
  $("landing").classList.remove("hidden");
  $("board").classList.add("hidden");
  $("streams-btn").classList.add("hidden");
  setHeader({ run: "—", clock: "00:00", phase: "ENGAGE" });
  setModeChip(state.mode);
  $("run-btn").disabled = true;
  $("run-btn").className = "primary";
  $("run-btn").textContent = "RUN";
  $("hint").textContent = "upload specs · then next";
}

function showBoard() {
  state.view = "board";
  $("landing").classList.add("hidden");
  $("board").classList.remove("hidden");
  renderBoard();
}

async function startRun() {
  const body = { mode: state.mode, ...previewBody() };
  const started = await api("/api/runs", { method: "POST", body: JSON.stringify(body) });
  state.runId = started.runId;
  state.board = { runId: started.runId, mode: started.mode, phase: "research", lanes: idleLanesFromPreview(), chips: state.preview?.chips, producer: state.preview?.producer, fleet_count: state.preview?.fleet?.counts, holding: false, elapsed_s: 0, controlling: true };
  renderBoard();
  startPoll();
  showCoach("arch");
}

async function killRun() {
  if (!state.runId || state.killing) return;
  state.killing = true;
  $("kill-btn").disabled = true;
  $("hint").textContent = "killing…";
  try {
    await api(`/api/runs/${state.runId}/abort`, { method: "POST", body: "{}" });
    await pollOnce();
  } catch (err) {
    $("hint").textContent = err instanceof Error ? err.message : String(err);
  } finally {
    state.killing = false;
  }
}

async function restart() {
  if (state.runId && state.board?.controlling) {
    try {
      await api(`/api/runs/${state.runId}/abort`, { method: "POST", body: "{}" });
    } catch {
      /* already finished */
    }
  }
  showLanding();
}

async function openLastRun() {
  const board = await api("/api/runs/latest");
  state.runId = board.runId;
  state.board = board;
  state.mode = board.mode;
  showBoard();
  if (board.phase !== "done" && board.phase !== "failed") startPoll();
}

function showOverlay(id, on) {
  const el = $(id);
  el.classList.toggle("hidden", !on);
  el.setAttribute("aria-hidden", on ? "false" : "true");
}

function showOverview() {
  showOverlay("overview", true);
}

function hideOverview() {
  showOverlay("overview", false);
}

let coachRaf = 0;

function coachHole() {
  if (state.coachStep === "live") return $("live-check");
  if (state.coachStep === "run") return $("run-btn");
  if (state.coachStep === "arch") return $("arch-btn");
  return null;
}

function placeCoach() {
  const step = state.coachStep;
  const hole = coachHole();
  const spot = $("coach-spot");
  const tip = $("coach-tip");
  if (!step || !hole || !spot || !tip) return;
  const rect = hole.getBoundingClientRect();
  const pad = step === "live" ? 16 : 22;
  const size = Math.max(rect.width, rect.height, 22) + pad * 2;
  spot.style.width = `${size}px`;
  spot.style.height = `${size}px`;
  spot.style.left = `${rect.left + rect.width / 2 - size / 2}px`;
  spot.style.top = `${rect.top + rect.height / 2 - size / 2}px`;
  if (step === "arch") {
    const tipW = Math.min(320, window.innerWidth - 32);
    tip.style.left = `${Math.max(16, rect.right - tipW)}px`;
    tip.style.top = `${rect.bottom + 18}px`;
    return;
  }
  const tipLeft = Math.max(16, Math.min(rect.left, window.innerWidth - 360));
  const below = rect.bottom + 18;
  const tipTop = below + 140 > window.innerHeight ? Math.max(16, rect.top - 150) : below;
  tip.style.left = `${tipLeft}px`;
  tip.style.top = `${tipTop}px`;
}

function onCoachMove() {
  if (!state.coachStep) return;
  if (coachRaf) cancelAnimationFrame(coachRaf);
  coachRaf = requestAnimationFrame(() => {
    coachRaf = 0;
    placeCoach();
  });
}

function bindCoachTracking(on) {
  window.removeEventListener("scroll", onCoachMove, true);
  window.removeEventListener("resize", onCoachMove);
  document.removeEventListener("scroll", onCoachMove, true);
  if (!on) return;
  window.addEventListener("scroll", onCoachMove, true);
  window.addEventListener("resize", onCoachMove);
  document.addEventListener("scroll", onCoachMove, true);
}

function showCoach(step) {
  state.coachStep = step;
  $("coach-text").textContent =
    step === "live"
      ? "Check LIVE to kick off a live Cursor SDK call, spinning up agents per repo. Leave it off for a stub rehearsal with no SDK calls."
      : step === "arch"
        ? "Run takes about 5 minutes. Review the design and decisions behind the tool."
        : "RUN starts research across every consumer. The gate holds until you approve or reject each spec.";
  $("coach").classList.remove("hidden");
  $("coach").setAttribute("aria-hidden", "false");
  bindCoachTracking(true);
  placeCoach();
}

function hideCoach() {
  bindCoachTracking(false);
  if (coachRaf) cancelAnimationFrame(coachRaf);
  coachRaf = 0;
  $("coach").classList.add("hidden");
  $("coach").setAttribute("aria-hidden", "true");
  state.coachStep = null;
}

function showContextModal() {
  const fromFleet = state.preview?.fleet?.business_context;
  if (!state.businessContext.trim() && fromFleet) {
    state.businessContext = String(fromFleet);
  }
  $("context-text").value = state.businessContext;
  showOverlay("context-modal", true);
}

function hideContextModal() {
  showOverlay("context-modal", false);
}

function applyContextFromTextarea() {
  state.businessContext = String($("context-text").value || "").trim();
}

async function downloadSample(path, filename) {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error("download failed");
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function afterAuth() {
  const meta = await api("/api/meta");
  state.meta = meta;
  $("v2-path").value = meta.defaults.v2;
  $("v3-path").value = meta.defaults.v3;
  $("fleet-path").value = meta.defaults.fleet;
  if (meta.liveEnabled) {
    $("live-toggle").classList.remove("disabled");
    $("live-check").disabled = false;
  }
  setModeChip(state.mode);
  await refreshPreview();
  showOverview();

  const params = new URLSearchParams(location.search);
  const run = params.get("run");
  if (run) {
    hideOverview();
    state.runId = run;
    try {
      state.board = await api(`/api/runs/${run}`);
      state.mode = state.board.mode;
      showBoard();
      if (state.board.phase !== "done" && state.board.phase !== "failed") startPoll();
    } catch (err) {
      $("hint").textContent = err instanceof Error ? err.message : String(err);
    }
  }
}

async function init() {
  bindFile("v2-file", "v2");
  bindFile("v3-file", "v3");
  bindFile("fleet-file", "fleet");
  $("next-btn").onclick = () => {
    if (!state.preview) return;
    hideCoach();
    showBoard();
    showContextModal();
  };
  $("run-btn").onclick = () => {
    if (state.view !== "board" || state.runId) return;
    hideCoach();
    startRun().catch((err) => {
      $("hint").textContent = err instanceof Error ? err.message : String(err);
    });
  };
  $("restart-btn").onclick = () => restart();
  $("kill-btn").onclick = () => {
    killRun().catch((err) => {
      $("hint").textContent = err instanceof Error ? err.message : String(err);
    });
  };
  $("last-run-btn").onclick = () => {
    openLastRun().catch((err) => {
      $("hint").textContent = err instanceof Error ? err.message : String(err);
    });
  };
  $("streams-btn").onclick = () => {
    state.allStreams = !state.allStreams;
    renderBoard();
  };
  $("login-form").onsubmit = (ev) => {
    ev.preventDefault();
    const password = $("login-password").value;
    $("login-error").classList.add("hidden");
    api("/api/login", { method: "POST", body: JSON.stringify({ password }) })
      .then(() => {
        $("login-gate").classList.add("hidden");
        state.authed = true;
        return afterAuth();
      })
      .catch((err) => {
        $("login-error").classList.remove("hidden");
        $("login-error").textContent = err instanceof Error ? err.message : String(err);
      });
  };
  $("overview-ok").onclick = () => {
    hideOverview();
    showCoach("live");
  };
  $("coach-next").onclick = () => hideCoach();
  $("context-skip").onclick = () => {
    hideContextModal();
    showCoach("run");
  };
  $("context-apply").onclick = () => {
    applyContextFromTextarea();
    hideContextModal();
    showCoach("run");
  };
  $("dl-fleet").onclick = () => {
    downloadSample("/api/samples/fleet.json", "fleet.template.json").catch((err) => {
      $("hint").textContent = err instanceof Error ? err.message : String(err);
    });
  };
  $("dl-v2").onclick = () => {
    downloadSample("/api/samples/openapi-v2.yaml", "openapi-v2.yaml").catch((err) => {
      $("hint").textContent = err instanceof Error ? err.message : String(err);
    });
  };
  $("dl-v3").onclick = () => {
    downloadSample("/api/samples/openapi-v3.yaml", "openapi-v3.yaml").catch((err) => {
      $("hint").textContent = err instanceof Error ? err.message : String(err);
    });
  };
  ArchitectureDrawer.mount();
  $("arch-btn").onclick = () => {
    hideCoach();
    ArchitectureDrawer.toggle();
  };
  $("arch-close").onclick = () => ArchitectureDrawer.close();
  $("arch").addEventListener("click", (ev) => {
    if (ev.target.closest("[data-close-arch]")) ArchitectureDrawer.close();
  });
  $("live-check").onchange = () => {
    state.mode = $("live-check").checked ? "live" : "stub";
    setModeChip(state.mode);
  };
  $("dossier-close").onclick = () => closeDossier();
  $("dossier-copy").onclick = () => {
    copyDossier().catch(() => {});
  };
  $("dossier").addEventListener("click", (ev) => {
    if (ev.target.closest("[data-close-dossier]")) closeDossier();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (ArchitectureDrawer.isOpen()) {
      ArchitectureDrawer.close();
      return;
    }
    if (state.modal) closeDossier();
  });

  const session = await fetch("/api/session", { credentials: "include" });
  if (session.ok) {
    $("login-gate").classList.add("hidden");
    state.authed = true;
    await afterAuth();
    return;
  }
  $("login-gate").classList.remove("hidden");
}

init().catch((err) => {
  $("preview").className = "preview-box err";
  $("preview").textContent = err instanceof Error ? err.message : String(err);
});
