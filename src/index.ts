import { runPipeline } from "./pipeline.ts";
import type { AgentMode } from "./run-agent.ts";

function parseArgs(argv: string[]): { mode: AgentMode; autoApprove: boolean } {
  const live = argv.includes("--live");
  const stubFlag = argv.includes("--stub");
  if (live && stubFlag) {
    throw new Error("pass either --stub or --live, not both");
  }
  const mode: AgentMode = live ? "live" : "stub";
  // Stub rehearsals must finish unattended (CI, reset-safe). --gate forces
  // the interactive y/n even in stub; --yes auto-approves in either mode.
  const autoApprove =
    argv.includes("--yes") || (mode === "stub" && !argv.includes("--gate"));
  return { mode, autoApprove };
}

const opts = parseArgs(process.argv.slice(2));
const started = Date.now();
const manifest = await runPipeline(opts);
const elapsedMs = Date.now() - started;
console.log(`elapsed ${elapsedMs}ms`);
if (opts.mode === "stub" && elapsedMs >= 10_000) {
  console.error("M0 budget is <10s for --stub; this run overran.");
  process.exitCode = 2;
}
if (!manifest.finishedAt) {
  process.exitCode = 1;
}
