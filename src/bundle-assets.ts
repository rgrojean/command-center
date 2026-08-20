import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FLEET_PATH,
  PROMPTS_DIR,
  STUBS_DIR,
  V2_SPEC_PATH,
  V3_SPEC_PATH,
} from "./paths.js";

/** Static reads so Vercel file tracing keeps demo assets in the function bundle. */
readFileSync(FLEET_PATH);
readFileSync(V2_SPEC_PATH);
readFileSync(V3_SPEC_PATH);
readFileSync(join(PROMPTS_DIR, "research-agent.md"));
readFileSync(join(PROMPTS_DIR, "human-impact-agent.md"));
readFileSync(join(PROMPTS_DIR, "write-agent.md"));
for (const name of [
  "cadence_scheduling_service.research.json",
  "cadence_scheduling_service.human-impact.json",
  "cadence_scheduling_service.write.json",
  "claims_service.research.json",
  "claims_service.human-impact.json",
  "patient_portal.research.json",
  "patient_portal.human-impact.json",
  "patient_portal.write.json",
  "reporting_service.research.json",
  "reporting_service.human-impact.json",
]) {
  readFileSync(join(STUBS_DIR, name));
}
