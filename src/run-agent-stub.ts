import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STUBS_DIR } from "./paths.ts";
import { HumanImpactSchema } from "./human-impact-schema.ts";
import { ResearchSpecSchema } from "./spec-schema.ts";
import { WriteSummarySchema } from "./write-summary-schema.ts";
import type { RunAgentOptions, RunAgentResult } from "./run-agent-types.ts";

/** Short enough that 4 repos × 2–3 calls stay well under the 10s M0 budget. */
const STUB_DELAY_MS = 40;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadStub(repo: string, kind: RunAgentOptions["kind"]): unknown {
  const path = join(STUBS_DIR, `${repo}.${kind}.json`);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  switch (kind) {
    case "research":
      return ResearchSpecSchema.parse(raw);
    case "human-impact":
      return HumanImpactSchema.parse(raw);
    case "write":
      return WriteSummarySchema.parse(raw);
  }
}

/**
 * Canned outputs, schema-validated on the way out so a drifting fixture
 * fails the pipeline the same way a bad live agent would.
 * Stub fixtures are rehearsal — they are never concatenated into live prompts.
 */
export async function runStubAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  await sleep(STUB_DELAY_MS);
  const result = loadStub(opts.repo, opts.kind);
  return {
    events: [
      {
        type: "stub",
        text: `stub ${opts.kind} for ${opts.repo} (model ${opts.model})`,
      },
      { type: "assistant", text: JSON.stringify(result) },
    ],
    result,
  };
}
