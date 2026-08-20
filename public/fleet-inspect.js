/* Fleet "View system" overlay for the Riverbend narrative.
 * Playback of artifacts copied into public/inspect/. Does not call Cadence,
 * ClaimBridge, or Lighthouse.
 */
(function () {
  if (window.__fleetInspectMounted) return;
  window.__fleetInspectMounted = true;

  const ARTIFACTS = {
    cadence: {
  "patientId": "100104",
  "name": "Williams, Sarah",
  "dob": "05/14/1990",
  "gender": "F",
  "ssn": "567-89-0123",
  "phone": "615-555-0121",
  "email": "swilliams.rvb@example.com",
  "address": {
    "line1": "900 Demonbreun St",
    "city": "Nashville",
    "state": "TN",
    "zip": "37203"
  }
},
    claim: "ISA*00*          *00*          *ZZ*RIVERBEND      *ZZ*CLEARINGHOUSE  *250101*0130*^*00501*202500042*0*P*:\nGS*HC*RIVERBEND*CLEARINGHOUSE*20250101*0130*1*X*005010X222A1\nST*837*0001*005010X222A1\nBHT*0019*00*RVB-2025-00042*20250101*0130*CH\nNM1*41*2*RIVERBEND HEALTH*****46*RVB001\nNM1*40*2*CLEARINGHOUSE*****46*CH001\nHL*1**20*1\nNM1*PR*2*TN_WORKERS_COMP*****PI*TN_WORKERS_COMP\nHL*2*1*22*0\nNM1*IL*1*GARCIA*MARIA****MI*123-45-6789\nN3*412 Oak Street\nN4*Nashville*TN*37211\nDMG*D8*19610315*F\nCLM*RVB-2025-00042*240.00***11:B:1*Y*A*Y*Y\nHI*ABK:S39012A\nLX*1\nSV1*HC:99214*240.00*UN*1***1\nDTP*472*D8*20250109\nSE*16*0001\nGE*1*1\nIEA*1*202500042\n",
    lighthouse: {"runId": "demographics_20260812_1786505772057", "pulledAt": "2026-08-12T03:36:12.094Z", "asOf": "2026-08-12", "facilities": [{"facility": "RVB", "metaTotal": 28, "records": [{"patientId": "483921", "gender": "F", "dob": "03/15/1961", "address": {"zip": "37211"}}, {"patientId": "100101", "gender": "F", "dob": "07/22/1978", "address": {"zip": "37212"}}, {"patientId": "100102", "gender": "M", "dob": "11/03/1955", "address": {"zip": "37203"}}, {"patientId": "100103", "gender": "M", "dob": "01/09/1982", "address": {"zip": "37203"}}, {"patientId": "100104", "gender": "F", "dob": "05/14/1990", "address": {"zip": "37203"}}, {"patientId": "550001", "gender": "F", "dob": "12/01/1973", "address": {"zip": "37201"}}, {"patientId": "550002", "gender": "F", "dob": "08/30/1949", "address": {"zip": "37215"}}, {"patientId": "100105", "gender": "M", "dob": "06/06/1952", "address": {"zip": "37206"}}, {"patientId": "100106", "gender": "M", "dob": "10/19/1985", "address": {"zip": "37203"}}, {"patientId": "100107", "gender": "F", "dob": "03/03/1964", "address": {"zip": "37211"}}, {"patientId": "100108", "gender": "F", "dob": "07/07/1991", "address": {"zip": "37203"}}, {"patientId": "100109", "gender": "M", "dob": "12/25/1979", "address": {"zip": "37214"}}, {"patientId": "100110", "gender": "F", "dob": "04/12/1988", "address": {"zip": "37217"}}, {"patientId": "100111", "gender": "M", "dob": "09/01/1947", "address": {"zip": "37205"}}, {"patientId": "100112", "gender": "F", "dob": "01/21/1971", "address": {"zip": "37209"}}, {"patientId": "100113", "gender": "M", "dob": "05/05/1983", "address": {"zip": "37208"}}, {"patientId": "100114", "gender": "F", "dob": "08/18/1960", "address": {"zip": "37204"}}, {"patientId": "100115", "gender": "M", "dob": "02/28/1993", "address": {"zip": "37203"}}, {"patientId": "100116", "gender": "F", "dob": "11/11/1976", "address": {"zip": "37211"}}, {"patientId": "100117", "gender": "M", "dob": "06/15/1986", "address": {"zip": "37208"}}, {"patientId": "100118", "gender": "F", "dob": "03/27/1958", "address": {"zip": "37203"}}, {"patientId": "100119", "gender": "M", "dob": "10/02/1997", "address": {"zip": "37212"}}, {"patientId": "100120", "gender": "F", "dob": "07/14/1969", "address": {"zip": "37203"}}, {"patientId": "100121", "gender": "M", "dob": "12/08/1980", "address": {"zip": "37214"}}, {"patientId": "100122", "gender": "F", "dob": "04/04/1992", "address": {"zip": "37206"}}, {"patientId": "100123", "gender": "M", "dob": "09/19/1954", "address": {"zip": "37207"}}, {"patientId": "100124", "gender": "F", "dob": "01/30/1975", "address": {"zip": "37211"}}, {"patientId": "100125", "gender": "F", "dob": "04/21/1984", "address": {"zip": "37211"}}]}, {"facility": "SAM", "metaTotal": 12, "records": [{"patientId": "200104", "gender": "F", "dob": "09/28/1987", "address": {"zip": "37040"}}, {"patientId": "550001", "gender": "M", "dob": "04/17/1968", "address": {"zip": "37044"}}, {"patientId": "550002", "gender": "M", "dob": "02/11/1995", "address": {"zip": "37042"}}, {"patientId": "200105", "gender": "M", "dob": "05/22/1966", "address": {"zip": "37040"}}, {"patientId": "200106", "gender": "F", "dob": "08/08/1994", "address": {"zip": "37040"}}, {"patientId": "200107", "gender": "M", "dob": "11/16/1959", "address": {"zip": "37040"}}, {"patientId": "200108", "gender": "F", "dob": "02/02/1981", "address": {"zip": "37042"}}, {"patientId": "200109", "gender": "M", "dob": "06/29/1970", "address": {"zip": "37040"}}, {"patientId": "200110", "gender": "F", "dob": "10/10/1948", "address": {"zip": "37042"}}, {"patientId": "200111", "gender": "M", "dob": "03/13/1989", "address": {"zip": "37042"}}, {"patientId": "200112", "gender": "F", "dob": "07/25/1963", "address": {"zip": "37040"}}, {"patientId": "200113", "gender": "M", "dob": "12/12/1977", "address": {"zip": "37042"}}]}]}
  };

  const SYSTEMS = [
    {
      match: "Patient Identity Service · v3",
      kind: "link",
      href: "http://localhost:4110/docs",
      dark: true,
    },
    {
      match: "Scheduling",
      kind: "popup",
      kicker: "Consumer 01 · Cadence",
      title: "Scheduling API",
      sentence: "The scheduling API, strict consumer, running right now.",
      command: "curl -s localhost:3001/patients?q=Williams | head",
      render: "cadence",
    },
    {
      match: "Claims billing",
      kind: "popup",
      kicker: "Consumer 02 · ClaimBridge",
      title: "Nightly 837 batch",
      sentence: "Last night's batch output — for workers'-comp payers, that subscriber ID field carries the SSN, by payer mandate.",
      command: "cat outbox/RVB-2025-00042.837",
      render: "claim",
    },
    {
      match: "Patient portal",
      kind: "link",
      href: "http://localhost:3107/admin",
      hint: "admin / admin",
    },
    {
      match: "Regulatory reporting",
      kind: "popup",
      kicker: "Consumer 04 · Lighthouse",
      title: "Quarterly extract",
      sentence: "Runs four times a year — nobody watches it, which matters later.",
      command: "cat exports/quarterly_extract_<latest> | head",
      render: "lighthouse",
    },
  ];

  const css = `
    .fi-btn {
      display: inline-flex; align-items: center; gap: 8px;
      margin-top: 4px; padding: 7px 11px;
      font-family: "IBM Plex Mono", ui-monospace, monospace;
      font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase;
      text-decoration: none; cursor: pointer;
      border-radius: 1px; background: transparent;
    }
    .fi-btn-light {
      border: 1px solid #17181a; color: #17181a;
    }
    .fi-btn-light:hover { background: #17181a; color: #faf9f7; }
    .fi-btn-dark {
      border: 1px solid #9a9fb0; color: #faf9f7;
    }
    .fi-btn-dark:hover { background: #2b4a8f; border-color: #2b4a8f; color: #fff; }
    .fi-scrim {
      position: fixed; inset: 0; z-index: 2147483646;
      background: rgba(23,24,26,0.46);
      display: flex; align-items: center; justify-content: center;
      padding: 32px 20px;
      border: 0;
      max-width: none;
      max-height: none;
    }
    .fi-scrim::backdrop { background: rgba(23,24,26,0.46); }
    .fi-panel {
      width: min(720px, 100%); max-height: min(86vh, 900px);
      background: #faf9f7; color: #17181a;
      border: 1px solid #17181a;
      display: flex; flex-direction: column;
      font-family: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, sans-serif;
      box-shadow: 0 18px 60px rgba(23,24,26,0.22);
    }
    .fi-head {
      padding: 22px 26px 16px;
      border-bottom: 1px solid #d8d5cf;
      display: flex; gap: 16px; align-items: flex-start;
    }
    .fi-kicker {
      font-family: "IBM Plex Mono", ui-monospace, monospace;
      font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase;
      color: #8a877f; margin-bottom: 6px;
    }
    .fi-title {
      font-size: 22px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 8px;
    }
    .fi-sentence { margin: 0; font-size: 15px; line-height: 1.45; color: #3a3935; max-width: 52ch; }
    .fi-close {
      margin-left: auto; flex-shrink: 0;
      font-family: "IBM Plex Mono", ui-monospace, monospace;
      font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase;
      border: 1px solid #17181a; background: #faf9f7; color: #17181a;
      padding: 7px 11px; cursor: pointer;
    }
    .fi-close:hover { background: #17181a; color: #faf9f7; }
    .fi-cmd {
      font-family: "IBM Plex Mono", ui-monospace, monospace;
      font-size: 12px; color: #6d6a63;
      background: #f1efe8; padding: 10px 26px;
      border-bottom: 1px solid #d8d5cf;
    }
    .fi-body { padding: 18px 26px 26px; overflow: auto; }
    .fi-pre {
      margin: 0; white-space: pre-wrap; word-break: break-word;
      font-family: "IBM Plex Mono", ui-monospace, monospace;
      font-size: 12.5px; line-height: 1.55; color: #17181a;
    }
    .fi-pre .hi, .fi-x12 .hi {
      background: #ece7c9; box-shadow: inset 0 -1px 0 #c9c093;
    }
    .fi-x12 { margin: 0; font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 12.5px; line-height: 1.6; }
    .fi-x12 div { padding: 1px 0; }
    .fi-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .fi-table th {
      text-align: left; font-family: "IBM Plex Mono", ui-monospace, monospace;
      font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase;
      color: #8a877f; font-weight: 500;
      border-bottom: 1px solid #d8d5cf; padding: 0 10px 8px 0;
    }
    .fi-table td { padding: 7px 10px 7px 0; border-bottom: 1px solid #eeeae3; font-variant-numeric: tabular-nums; }
    .fi-meta { margin: 0 0 14px; font-size: 13px; color: #6d6a63; }
  `;

  function injectCss() {
    if (document.getElementById("fi-css")) return;
    const style = document.createElement("style");
    style.id = "fi-css";
    style.textContent = css;
    document.documentElement.appendChild(style);
  }

  function walk(root, visit) {
    visit(root);
    const all = root.querySelectorAll ? root.querySelectorAll("*") : [];
    for (const el of all) {
      visit(el);
      if (el.shadowRoot) walk(el.shadowRoot, visit);
    }
  }

  function findTitle(needle) {
    let found = null;
    walk(document.body, (el) => {
      if (found || !el || el.nodeType !== 1) return;
      if (el.getAttribute && el.getAttribute("data-fi-btn")) return;
      if (el.children && el.children.length > 0) return;
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (t === needle) found = el;
    });
    return found;
  }

  function cardOf(titleEl) {
    let n = titleEl;
    for (let i = 0; i < 6 && n; i++) {
      const style = n.getAttribute && n.getAttribute("style") || "";
      if (style.includes("border") && style.includes("padding")) return n;
      n = n.parentElement;
    }
    return titleEl.parentElement || titleEl;
  }

  function ageBand(dob, asOf) {
    const [mm, dd, yyyy] = dob.split("/").map(Number);
    const asOfDate = new Date(asOf + "T00:00:00Z");
    const birth = new Date(Date.UTC(yyyy, mm - 1, dd));
    let age = asOfDate.getUTCFullYear() - birth.getUTCFullYear();
    const m = asOfDate.getUTCMonth() - birth.getUTCMonth();
    if (m < 0 || (m === 0 && asOfDate.getUTCDate() < birth.getUTCDate())) age -= 1;
    if (age < 18) return "0-17";
    if (age < 35) return "18-34";
    if (age < 50) return "35-49";
    if (age < 65) return "50-64";
    return "65+";
  }

  function zip3(zip) {
    return String(zip).slice(0, 3);
  }

  function renderCadence() {
    const raw = JSON.stringify(ARTIFACTS.cadence, null, 2);
    const esc = raw.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const hi = esc.replace(
      /^(\s*"(?:name|ssn)":\s*)(.*)$/gm,
      '$1<span class="hi">$2</span>'
    );
    return `<pre class="fi-pre">${hi}</pre>`;
  }

  function renderClaim() {
    const lines = ARTIFACTS.claim.replace(/\n$/, "").split("\n");
    const html = lines.map((line) => {
      const esc = line.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      const marked = /NM1\*IL\*/.test(line) || /NM1\*PR\*2\*TN_WORKERS_COMP/.test(line)
        ? `<span class="hi">${esc}</span>`
        : esc;
      return `<div>${marked}</div>`;
    }).join("");
    return `<div class="fi-x12">${html}</div>`;
  }

  function renderLighthouse() {
    const snap = ARTIFACTS.lighthouse;
    const counts = new Map();
    for (const f of snap.facilities) {
      for (const r of f.records) {
        const key = [f.facility, ageBand(r.dob, snap.asOf), r.gender, zip3(r.address.zip)].join("|");
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    const rows = [...counts.entries()]
      .map(([k, n]) => {
        const [facility, age_band, gender, z] = k.split("|");
        return { facility, age_band, gender, zip3: z, n };
      })
      .sort((a, b) =>
        `${a.facility}${a.age_band}${a.gender}${a.zip3}`.localeCompare(
          `${b.facility}${b.age_band}${b.gender}${b.zip3}`
        )
      );
    const body = rows.map((r) =>
      `<tr><td>${r.facility}</td><td>${r.age_band}</td><td>${r.gender}</td><td>${r.zip3}</td><td>${r.n}</td></tr>`
    ).join("");
    return `
      <p class="fi-meta">run ${snap.runId} · as of ${snap.asOf} · ${rows.length} rows · names and SSNs already gone</p>
      <table class="fi-table">
        <thead><tr><th>Facility</th><th>Age band</th><th>Gender</th><th>ZIP3</th><th>N</th></tr></thead>
        <tbody>${body}</tbody>
      </table>`;
  }

  const renders = { cadence: renderCadence, claim: renderClaim, lighthouse: renderLighthouse };

  let lastOpenAt = 0;
  let ignoreCloseUntil = 0;

  function closePopup() {
    const el = document.getElementById("fi-scrim");
    if (el && typeof el.close === "function" && el.open) el.close();
    if (el) el.remove();
  }

  function openPopup(sys) {
    closePopup();
    const scrim = document.createElement("dialog");
    scrim.id = "fi-scrim";
    scrim.className = "fi-scrim";
    scrim.innerHTML = `
      <div class="fi-panel">
        <div class="fi-head">
          <div>
            <div class="fi-kicker">${sys.kicker}</div>
            <h3 class="fi-title">${sys.title}</h3>
            <p class="fi-sentence">${sys.sentence}</p>
          </div>
          <button class="fi-close" type="button">Close</button>
        </div>
        <div class="fi-cmd">${sys.command.replace(/</g, "&lt;")}</div>
        <div class="fi-body">${renders[sys.render]()}</div>
      </div>`;
    document.documentElement.appendChild(scrim);
    const maybeCloseBackdrop = (e) => {
      if (e.target !== scrim) return;
      if (performance.now() < ignoreCloseUntil) return;
      closePopup();
    };
    scrim.querySelector(".fi-close").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closePopup();
    });
    scrim.addEventListener("click", maybeCloseBackdrop);
    scrim.addEventListener("cancel", (e) => {
      e.preventDefault();
      closePopup();
    });
    if (typeof scrim.showModal === "function") scrim.showModal();
    else scrim.setAttribute("open", "");
  }

  function systemFor(match) {
    return SYSTEMS.find((s) => s.match === match);
  }

  function makeControl(sys) {
    if (sys.kind === "link") {
      const a = document.createElement("a");
      a.className = "fi-btn " + (sys.dark ? "fi-btn-dark" : "fi-btn-light");
      a.href = sys.href;
      a.target = "_blank";
      a.rel = "noopener";
      a.setAttribute("data-fi-btn", sys.match);
      a.textContent = "View system →";
      if (sys.hint) a.title = sys.hint;
      return a;
    }
    const b = document.createElement("button");
    b.type = "button";
    b.className = "fi-btn fi-btn-light";
    b.setAttribute("data-fi-btn", sys.match);
    b.textContent = "View system →";
    return b;
  }

  function onActivate(e) {
    const el = e.target && e.target.closest ? e.target.closest("[data-fi-btn]") : null;
    if (!el) return;
    const sys = systemFor(el.getAttribute("data-fi-btn"));
    if (!sys) return;
    if (sys.kind === "link") {
      e.stopPropagation();
      return;
    }
    if (e.type === "pointerdown" && e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
    const now = performance.now();
    if (now - lastOpenAt < 50) return;
    lastOpenAt = now;
    ignoreCloseUntil = now + 400;
    openPopup(sys);
  }

  function attach() {
    injectCss();
    if (!document.body) return 0;
    let n = 0;
    for (const sys of SYSTEMS) {
      if (document.querySelector(`[data-fi-btn="${CSS.escape(sys.match)}"]`)) {
        n += 1;
        continue;
      }
      const title = findTitle(sys.match);
      if (!title) continue;
      const card = cardOf(title);
      card.appendChild(makeControl(sys));
      n += 1;
    }
    return n;
  }

  function start() {
    injectCss();
    document.addEventListener("click", onActivate, true);
    document.addEventListener("pointerdown", onActivate, true);
    let tries = 0;
    const tick = () => {
      const n = attach();
      tries += 1;
      if (n >= SYSTEMS.length || tries > 40) return;
      setTimeout(tick, 200);
    };
    tick();
    const obs = new MutationObserver(() => attach());
    const bootObs = () => {
      if (!document.body) return setTimeout(bootObs, 50);
      obs.observe(document.body, { childList: true, subtree: true });
    };
    bootObs();
  }

  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
