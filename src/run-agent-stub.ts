import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PipelineKilled } from "./hold.js";
import { STUBS_DIR } from "./paths.js";
import { HumanImpactSchema } from "./human-impact-schema.js";
import { WriteSummarySchema } from "./write-summary-schema.js";
import type { RunAgentOptions, RunAgentResult } from "./run-agent-types.js";

/** Long enough that a 1s board poll sees all eight research cards live (D33). */
const STUB_DELAY_MS = 450;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new PipelineKilled());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new PipelineKilled());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function loadStub(repo: string, kind: RunAgentOptions["kind"]): unknown {
  const path = join(STUBS_DIR, `${repo}.${kind}.json`);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  switch (kind) {
    case "research":
      return raw;
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
  await sleep(STUB_DELAY_MS, opts.signal);
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
