import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isVercel } from "./runtime.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** Package root (command-center/), not process.cwd() — CI and reset.sh may invoke from elsewhere. */
export const ROOT = join(here, "..");
export const FLEET_PATH = join(ROOT, "fleet.json");
const ephemeral = isVercel() ? "/tmp/spec-migrator" : ROOT;
export const STATE_DIR = join(ephemeral, "state");
export const WORKSPACES_DIR = join(ephemeral, "workspaces");
export const PROMPTS_DIR = join(ROOT, "prompts");
export const STUBS_DIR = join(ROOT, "fixtures", "stubs");
export const WEB_DIR = join(ROOT, "public");
export const V2_SPEC_PATH = join(ROOT, "specs", "pis-openapi-v2.yaml");
export const V3_SPEC_PATH = join(ROOT, "specs", "pis-openapi-v3.yaml");
/** Copied into a consumer workspace so the write agent can read it. Not committed. */
export const V3_SPEC_COPY = ".openapi-v3.yaml";
