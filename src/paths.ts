import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Package root (command-center/), not process.cwd() — CI and reset.sh may invoke from elsewhere. */
export const ROOT = join(here, "..");
export const FLEET_PATH = join(ROOT, "fleet.json");
export const STATE_DIR = join(ROOT, "state");
export const WORKSPACES_DIR = join(ROOT, "workspaces");
export const PROMPTS_DIR = join(ROOT, "prompts");
export const STUBS_DIR = join(ROOT, "fixtures", "stubs");
