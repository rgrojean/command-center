import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROMPTS_DIR } from "./paths.js";
import { schemaToPromptJson } from "./json-schema.js";
import { HumanImpactSchema } from "./human-impact-schema.js";
import { WriteSummarySchema } from "./write-summary-schema.js";
import type { z } from "zod";

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

export function formatBusinessContext(lines: string[] | undefined): string {
  const items = (lines ?? []).map((s) => s.trim()).filter(Boolean);
  if (items.length === 0) {
    return "_No additional business context was provided._";
  }
  return [
    "The operator supplied this context about the producer API and consuming fleet.",
    "Use it when judging impact, blockers, and required changes.",
    "It does not replace citations from the repository.",
    "",
    ...items.map((s) => `- ${s}`),
  ].join("\n");
}

export function renderResearchPrompt(
  repo: string,
  diffSummary: string,
  changedFields: string[],
  researchSchema: z.ZodType,
  businessContext?: string[],
): string {
  return fill(loadTemplate("research"), {
    REPO_NAME: repo,
    DIFF_SUMMARY: diffSummary,
    CHANGED_FIELDS: changedFields.map((f) => `\`${f}\``).join(", "),
    BUSINESS_CONTEXT: formatBusinessContext(businessContext),
    SPEC_SCHEMA_JSON: schemaToPromptJson(researchSchema, "ResearchSpec"),
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
  businessContext?: string[];
}): string {
  return fill(loadTemplate("write"), {
    REPO_NAME: opts.repo,
    SPEC_JSON: opts.specJson,
    DIFF_SUMMARY: opts.diffSummary,
    V3_SPEC_PATH: opts.v3SpecPath,
    RETRY_BUDGET: String(opts.retryBudget),
    BUSINESS_CONTEXT: formatBusinessContext(opts.businessContext),
    WRITE_SUMMARY_SCHEMA_JSON: schemaToPromptJson(
      WriteSummarySchema,
      "WriteSummary",
    ),
  });
}
