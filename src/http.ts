import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Express, Request, Response } from "express";
import { assembleBoard, chipsFromDiff, latestRunId, liveEnabled } from "./board-payload.js";
import { diffOpenApi, resolveV2Path } from "./diff.js";
import { businessContextProse, loadFleet, parseFleet, producerOf } from "./fleet.js";
import { createHttpHold, type HttpDecision, type HttpHold } from "./hold.js";
import { FLEET_PATH, STATE_DIR, V2_SPEC_PATH, V3_SPEC_PATH } from "./paths.js";
import { runPipeline } from "./pipeline.js";
import { ExecutionGradeSchema } from "./spec-schema.js";
import {
  createRun,
  listRunIds,
  nowIso,
  promptPath,
  readManifest,
  runDirFor,
  writeJson,
  writeManifest,
} from "./state.js";

const ENGAGE_DIR = join(STATE_DIR, "_engage");

type ActiveRun = {
  runId: string;
  hold: HttpHold;
  done: Promise<unknown>;
};

let active: ActiveRun | undefined;

function jsonError(res: Response, status: number, error: string) {
  res.status(status).json({ error });
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing :${name}`);
  }
  return value;
}

function controlling(runId: string): boolean {
  return active?.runId === runId;
}

type InputBody = {
  mode?: "stub" | "live";
  v2?: string;
  v3?: string;
  fleet?: string;
  v2Path?: string;
  v3Path?: string;
  fleetPath?: string;
  business_context?: string | string[];
};

function normalizeContext(raw: unknown): string | undefined {
  if (typeof raw !== "string" && !Array.isArray(raw)) return undefined;
  const prose = businessContextProse(raw);
  return prose || undefined;
}

function writeIfText(dir: string, name: string, text: string | undefined): string | undefined {
  if (typeof text !== "string" || text.trim() === "") return undefined;
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

function materializeInputs(
  body: InputBody,
  dir: string,
): { v2Path: string; v3Path: string; fleetPath: string } {
  const v2Path =
    writeIfText(dir, "v2.yaml", body.v2) ?? (typeof body.v2Path === "string" ? body.v2Path : V2_SPEC_PATH);
  const v3Path =
    writeIfText(dir, "v3.yaml", body.v3) ?? (typeof body.v3Path === "string" ? body.v3Path : V3_SPEC_PATH);
  const fleetPath =
    writeIfText(dir, "fleet.json", body.fleet) ??
    (typeof body.fleetPath === "string" ? body.fleetPath : FLEET_PATH);
  return { v2Path, v3Path, fleetPath };
}

function previewFrom(paths: { v2Path: string; v3Path: string; fleetPath: string }) {
  const fleet = loadFleet(paths.fleetPath);
  const producer = producerOf(fleet);
  const v2Resolved =
    paths.v2Path === V2_SPEC_PATH ? resolveV2Path(producer.slug, V2_SPEC_PATH) : paths.v2Path;
  const diff = diffOpenApi(v2Resolved, paths.v3Path);
  return {
    ok: true as const,
    paths: { ...paths, v2Path: v2Resolved },
    producer: { slug: producer.slug, display_name: producer.display_name },
    fleet: {
      org: fleet.org,
      start_ref: fleet.start_ref,
      business_context: businessContextProse(fleet.business_context),
      repos: fleet.repos.map((r) => ({
        slug: r.slug,
        display_name: r.display_name,
        kind: r.kind,
        role: r.role,
        port: r.port,
        db_port: r.db_port,
        start_ref: r.start_ref,
        default_branch: r.default_branch,
      })),
      counts: {
        repos: fleet.repos.length,
        producers: 1,
        consumers: fleet.repos.filter((r) => r.role === "consumer").length,
      },
    },
    diff: {
      fields: diff.fields,
      changes: diff.changes,
      added: diff.added,
      unchanged: diff.unchanged,
      summary: diff.summary,
    },
    chips: chipsFromDiff(diff),
  };
}

export function mountHttp(app: Express): void {
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/samples/fleet.json", (_req, res) => {
    const fleet = loadFleet(FLEET_PATH);
    const body = {
      ...fleet,
      business_context: businessContextProse(fleet.business_context),
    };
    res.setHeader("Content-Disposition", 'attachment; filename="fleet.template.json"');
    res.json(body);
  });

  app.get("/api/samples/openapi-v2.yaml", (_req, res) => {
    res.setHeader("Content-Disposition", 'attachment; filename="openapi-v2.yaml"');
    res.type("text/yaml").send(readFileSync(V2_SPEC_PATH, "utf8"));
  });

  app.get("/api/samples/openapi-v3.yaml", (_req, res) => {
    res.setHeader("Content-Disposition", 'attachment; filename="openapi-v3.yaml"');
    res.type("text/yaml").send(readFileSync(V3_SPEC_PATH, "utf8"));
  });

  app.get("/api/meta", (_req, res) => {
    const fleet = loadFleet(FLEET_PATH);
    res.json({
      liveEnabled: liveEnabled(),
      defaults: { v2: V2_SPEC_PATH, v3: V3_SPEC_PATH, fleet: FLEET_PATH },
      producer: { slug: fleet.producer, display_name: producerOf(fleet).display_name },
      sampleDownloads: {
        fleet: "/api/samples/fleet.json",
        v2: "/api/samples/openapi-v2.yaml",
        v3: "/api/samples/openapi-v3.yaml",
      },
    });
  });

  app.post("/api/preview", (req: Request, res: Response) => {
    try {
      const paths = materializeInputs(req.body as InputBody, ENGAGE_DIR);
      res.json(previewFrom(paths));
    } catch (err) {
      jsonError(res, 400, err instanceof Error ? err.message : String(err));
    }
  });

  app.get("/api/runs", (_req, res) => {
    res.json({
      active: active?.runId ?? null,
      runs: listRunIds(),
    });
  });

  app.get("/api/runs/latest", (_req, res) => {
    const id = latestRunId();
    if (!id) return jsonError(res, 404, "no runs in state/");
    res.json(assembleBoard(id, controlling(id)));
  });

  app.get("/api/runs/:id", (req, res) => {
    try {
      const id = param(req, "id");
      res.json(assembleBoard(id, controlling(id)));
    } catch (err) {
      jsonError(res, 404, err instanceof Error ? err.message : String(err));
    }
  });

  app.post("/api/runs", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as InputBody;
    const mode = body.mode === "live" ? "live" : "stub";
    if (mode === "live" && !liveEnabled()) {
      return jsonError(res, 400, "LIVE requires CURSOR_API_KEY");
    }
    if (active) {
      return res.status(409).json({
        error: "a run is already in progress",
        runId: active.runId,
      });
    }

    let paths: { v2Path: string; v3Path: string; fleetPath: string };
    try {
      paths = materializeInputs(body, ENGAGE_DIR);
      loadFleet(paths.fleetPath);
      if (typeof body.fleet === "string") parseFleet(JSON.parse(body.fleet));
      previewFrom(paths);
    } catch (err) {
      return jsonError(res, 400, err instanceof Error ? err.message : String(err));
    }

    const existing = createRun(mode);
    const inputDir = join(existing.dir, "inputs");
    const runPaths = materializeInputs(body, inputDir);
    const hold = createHttpHold();
    const done = runPipeline({
      mode,
      autoApprove: false,
      until: "write",
      v2Path: runPaths.v2Path,
      v3Path: runPaths.v3Path,
      fleetPath: runPaths.fleetPath,
      businessContext:
        normalizeContext(body.business_context) ??
        businessContextProse(loadFleet(runPaths.fleetPath).business_context),
      httpHold: hold,
      existing,
    })
      .catch((err: unknown) => {
        try {
          const manifest = readManifest(existing.dir);
          manifest.phase = "failed";
          manifest.error = err instanceof Error ? err.message : String(err);
          writeManifest(existing.dir, manifest);
        } catch {
          /* dir may be incomplete */
        }
        console.error(`run ${existing.runId} failed:`, err);
      })
      .finally(() => {
        if (active?.runId === existing.runId) active = undefined;
      });

    active = { runId: existing.runId, hold, done };
    void keepAlive(done);
    res.status(201).json({ runId: existing.runId, mode, phase: "research" });
  });

  app.get("/api/runs/:id/specs/:repo/prompt", (req: Request, res: Response) => {
    let runId: string;
    let slug: string;
    try {
      runId = param(req, "id");
      slug = param(req, "repo");
    } catch (err) {
      return jsonError(res, 400, err instanceof Error ? err.message : String(err));
    }
    const stage = req.query.stage;
    if (stage !== "research" && stage !== "human_impact" && stage !== "write") {
      return jsonError(res, 400, "stage must be research, human_impact, or write");
    }
    const path = promptPath(runDirFor(runId), slug, stage);
    if (!existsSync(path)) return jsonError(res, 404, "prompt not captured yet");
    res.json({ stage, prompt: readFileSync(path, "utf8") });
  });

  app.post("/api/runs/:id/specs/:repo/decision", (req: Request, res: Response) => {
    let runId: string;
    let slug: string;
    try {
      runId = param(req, "id");
      slug = param(req, "repo");
    } catch (err) {
      return jsonError(res, 400, err instanceof Error ? err.message : String(err));
    }
    if (!active || active.runId !== runId) {
      return jsonError(res, 409, "run is not holding for HTTP decisions");
    }
    const body = (req.body ?? {}) as {
      decision?: string;
      note?: string;
      grade_override?: string;
      model_override?: string;
    };
    if (body.decision !== "approved" && body.decision !== "rejected") {
      return jsonError(res, 400, "decision must be approved or rejected");
    }
    let grade_override: HttpDecision["grade_override"];
    if (body.grade_override !== undefined) {
      const parsed = ExecutionGradeSchema.safeParse(body.grade_override);
      if (!parsed.success) return jsonError(res, 400, "invalid grade_override");
      grade_override = parsed.data;
    }

    try {
      const snapshot = assembleBoard(runId, true);
      const lane = snapshot.lanes.find((l) => l.slug === slug);
      if (!lane) return jsonError(res, 404, `unknown consumer ${slug}`);
      if (!lane.needs_decision) {
        return jsonError(res, 409, `${slug} does not need a human decision`);
      }
      if (lane.decision || lane.gate === "approved" || lane.gate === "rejected") {
        return jsonError(res, 409, `${slug} already decided`);
      }
    } catch (err) {
      return jsonError(res, 404, err instanceof Error ? err.message : String(err));
    }

    const record: HttpDecision = {
      decision: body.decision,
      note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : undefined,
      grade_override,
      model_override:
        typeof body.model_override === "string" && body.model_override.trim()
          ? body.model_override.trim()
          : undefined,
      at: nowIso(),
    };
    writeJson(runDirFor(runId), slug, "decision.json", record);
    const manifest = readManifest(runDirFor(runId));
    const entry = manifest.repos[slug];
    if (entry) {
      entry.gate = record.decision;
      if (record.note) entry.gate_note = record.note;
      if (record.grade_override) entry.grade_override = record.grade_override;
      if (record.model_override) entry.model_override = record.model_override;
      writeManifest(runDirFor(runId), manifest);
    }
    active.hold.record(slug, record);
    res.json({ ok: true, runId, repo: slug, decision: record });
  });

  app.post("/api/runs/:id/release", (req: Request, res: Response) => {
    let runId: string;
    try {
      runId = param(req, "id");
    } catch (err) {
      return jsonError(res, 400, err instanceof Error ? err.message : String(err));
    }
    if (!active || active.runId !== runId) {
      return jsonError(res, 409, "run is not holding for release");
    }
    let snapshot;
    try {
      snapshot = assembleBoard(runId, true);
    } catch (err) {
      return jsonError(res, 404, err instanceof Error ? err.message : String(err));
    }
    if (snapshot.phase !== "gate") {
      return jsonError(res, 409, `run is in phase ${snapshot.phase}, not gate`);
    }
    if (snapshot.pending_decisions.length > 0) {
      return res.status(409).json({
        error: "not every pending spec has a decision",
        pending_decisions: snapshot.pending_decisions,
      });
    }
    active.hold.release();
    res.json({ ok: true, runId, phase: "write" });
  });

  app.post("/api/runs/:id/abort", (req: Request, res: Response) => {
    let runId: string;
    try {
      runId = param(req, "id");
    } catch (err) {
      return jsonError(res, 400, err instanceof Error ? err.message : String(err));
    }
    if (!active || active.runId !== runId) {
      return jsonError(res, 409, "run is not active");
    }
    active.hold.abort("killed from dashboard");
    try {
      const manifest = readManifest(runDirFor(runId));
      manifest.phase = "failed";
      manifest.error = "killed from dashboard";
      writeManifest(runDirFor(runId), manifest);
    } catch {
      /* run dir may be incomplete */
    }
    res.json({ ok: true, runId, phase: "failed" });
  });
}

export function getActiveRunId(): string | undefined {
  return active?.runId;
}

async function keepAlive(done: Promise<unknown>): Promise<void> {
  try {
    const mod = await import("@vercel/functions");
    mod.waitUntil(done);
  } catch {
    /* local Node: the promise is already running */
  }
}
