import { parseConcurrency, type Concurrency } from "./concurrency.js";
import { runPipeline, type PipelineOptions } from "./pipeline.js";
import type { AgentMode } from "./run-agent.js";

function argValue(argv: string[], name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = argv.indexOf(name);
  if (i >= 0) return argv[i + 1];
  return undefined;
}

function parseArgs(argv: string[]): PipelineOptions {
  const live = argv.includes("--live");
  const stubFlag = argv.includes("--stub");
  if (live && stubFlag) {
    throw new Error("pass either --stub or --live, not both");
  }
  const mode: AgentMode = live ? "live" : "stub";
  const autoApprove =
    argv.includes("--yes") || (mode === "stub" && !argv.includes("--gate"));
  const raw = argValue(argv, "--until");
  const until: PipelineOptions["until"] =
    raw === "write" || raw === "gate" ? raw : mode === "live" ? "gate" : "write";
  const reposRaw = argValue(argv, "--repos");
  const fromRun = argValue(argv, "--from-run");
  const researchRaw = argValue(argv, "--research-concurrency");
  const writeRaw = argValue(argv, "--write-concurrency");
  const researchConcurrency: Concurrency | undefined = researchRaw
    ? parseConcurrency(researchRaw)
    : undefined;
  const writeConcurrency: Concurrency | undefined = writeRaw
    ? parseConcurrency(writeRaw)
    : undefined;
  return {
    mode,
    autoApprove,
    until,
    repos: reposRaw ? reposRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    fromRun,
    v2Path: argValue(argv, "--v2"),
    v3Path: argValue(argv, "--v3"),
    fleetPath: argValue(argv, "--fleet"),
    researchConcurrency,
    writeConcurrency,
  };
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
