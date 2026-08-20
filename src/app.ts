import express from "express";
import { loginHandler, requireAuth, sessionHandler } from "./auth.ts";
import { diffOpenApi, resolveV2Path } from "./diff.ts";
import { loadFleet } from "./fleet.ts";
import { mountHttp } from "./http.ts";
import { FLEET_PATH, V2_SPEC_PATH, V3_SPEC_PATH, WEB_DIR } from "./paths.ts";

const app = express();
app.use(express.json({ limit: "8mb" }));
app.use(requireAuth);
app.post("/api/login", loginHandler);
app.get("/api/session", sessionHandler);
app.use(express.static(WEB_DIR));

mountHttp(app);

app.get("/api/diff", (req, res) => {
  try {
    const v2 = typeof req.query.v2 === "string" ? req.query.v2 : V2_SPEC_PATH;
    const v3 = typeof req.query.v3 === "string" ? req.query.v3 : V3_SPEC_PATH;
    const fleet = typeof req.query.fleet === "string" ? req.query.fleet : FLEET_PATH;
    const loaded = loadFleet(fleet);
    const v2Resolved = typeof req.query.v2 === "string" ? v2 : resolveV2Path(loaded.producer);
    const diff = diffOpenApi(v2Resolved, v3);
    res.json({
      fleet: fleet,
      producer: loaded.producer,
      fields: diff.fields,
      added: diff.added,
      unchanged: diff.unchanged,
      changes: diff.changes,
      summary: diff.summary,
      command: `npm run pipeline -- --stub --v2=${v2Resolved} --v3=${v3} --fleet=${fleet}`,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default app;
