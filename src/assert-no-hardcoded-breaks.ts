import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { PROMPTS_DIR, ROOT } from "./paths.js";

/**
 * D30: breaking field names must come from the diff, not from literals in
 * orchestrator code or prompt templates. Fixtures and producer YAMLs may
 * still name this fleet's fields.
 */
const FORBIDDEN = [
  '["ssn", "name", "patientId"]',
  '["ssn","name","patientId"]',
  "`ssn`, `name`, `patientId`",
  "BreakingFieldSchema",
  "REMOVED_FIELDS",
];

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const files = [
  ...walk(join(ROOT, "src")).filter((f) => f.endsWith(".ts")),
  ...walk(PROMPTS_DIR).filter((f) => f.endsWith(".md")),
];

const hits: string[] = [];
for (const file of files) {
  if (file.endsWith("assert-no-hardcoded-breaks.ts")) continue;
  const text = readFileSync(file, "utf8");
  for (const needle of FORBIDDEN) {
    if (text.includes(needle)) {
      hits.push(`${relative(ROOT, file)}: ${needle}`);
    }
  }
}

if (hits.length) {
  console.error("D30: hardcoded breaking-field literals outside fixtures/:\n" + hits.join("\n"));
  process.exit(1);
}
console.log(`D30: no hardcoded breaking-field literals in src/ or prompts/ (${files.length} files).`);
