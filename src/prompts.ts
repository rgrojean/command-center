import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROMPTS_DIR } from "./paths.ts";
import { schemaToPromptJson } from "./json-schema.ts";
import { HumanImpactSchema } from "./human-impact-schema.ts";
import { ResearchSpecSchema } from "./spec-schema.ts";
import { WriteSummarySchema } from "./write-summary-schema.ts";

export type PromptKind = "research" | "human-impact" | "write";

function loadTemplate(kind: PromptKind): string {
  return readFileSync(join(PROMPTS_DIR, `${kind}-agent.md`), "utf8");
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key: string) => {
    if (!(key in vars)) {
      throw new Error(`prompt template missing substitution for {{${key}}}`);
    }
    return vars[key] ?? match;
  });
}

export function renderResearchPrompt(repo: string, diffSummary: string): string {
  return fill(loadTemplate("research"), {
    REPO_NAME: repo,
    DIFF_SUMMARY: diffSummary,
    SPEC_SCHEMA_JSON: schemaToPromptJson(ResearchSpecSchema, "ResearchSpec"),
  });
}

export function renderHumanImpactPrompt(repo: string, diffSummary: string): string {
  return fill(loadTemplate("human-impact"), {
    REPO_NAME: repo,
    DIFF_SUMMARY: diffSummary,
    HUMAN_IMPACT_SCHEMA_JSON: schemaToPromptJson(
      HumanImpactSchema,
      "DownstreamImpacts",
    ),
  });
}

export function renderWritePrompt(opts: {
  repo: string;
  specJson: string;
  diffSummary: string;
  v3SpecPath: string;
  retryBudget: number;
}): string {
  return fill(loadTemplate("write"), {
    REPO_NAME: opts.repo,
    SPEC_JSON: opts.specJson,
    DIFF_SUMMARY: opts.diffSummary,
    V3_SPEC_PATH: opts.v3SpecPath,
    RETRY_BUDGET: String(opts.retryBudget),
    WRITE_SUMMARY_SCHEMA_JSON: schemaToPromptJson(
      WriteSummarySchema,
      "WriteSummary",
    ),
  });
}
