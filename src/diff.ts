import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { V2_SPEC_PATH, V3_SPEC_PATH, WORKSPACES_DIR } from "./paths.ts";

type Json = Record<string, unknown>;

export type BreakingKind = "removed" | "type_changed";

export type BreakingChange = {
  field: string;
  kind: BreakingKind;
  from: string;
  to: string;
  schema: string;
};

export type DiffResult = {
  v2Path: string;
  v3Path: string;
  changes: BreakingChange[];
  /** v2 property names that broke — source of truth for `call_sites.field`. */
  fields: string[];
  /** Newly added properties; not breaking (additive). */
  added: string[];
  unchanged: string[];
  summary: string;
};

function loadYaml(path: string): Json {
  return parseYaml(readFileSync(path, "utf8")) as Json;
}

function objectSchemas(doc: Json): Record<string, Json> {
  const components = doc.components as Json | undefined;
  const schemas = components?.schemas as Json | undefined;
  if (!schemas) return {};
  const out: Record<string, Json> = {};
  for (const [name, raw] of Object.entries(schemas)) {
    if (!raw || typeof raw !== "object") continue;
    const schema = raw as Json;
    if (schema.properties && typeof schema.properties === "object") {
      out[name] = schema;
    }
  }
  return out;
}

function schemaRefCounts(doc: Json): Map<string, number> {
  const counts = new Map<string, number>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const o = node as Json;
    if (typeof o.$ref === "string") {
      const name = String(o.$ref).split("/").pop();
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    for (const value of Object.values(o)) walk(value);
  };
  walk(doc.paths);
  return counts;
}

function propKeys(schema: Json): string[] {
  const props = (schema.properties ?? {}) as Json;
  return Object.keys(props).sort();
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function describeType(node: unknown, doc?: Json): string {
  if (node === undefined) return "absent";
  if (typeof node !== "object" || node === null) return String(node);
  const n = node as Json;
  if (typeof n.$ref === "string") {
    const name = String(n.$ref).split("/").pop() ?? "ref";
    const resolved = resolveRef(doc, String(n.$ref));
    if (resolved?.properties && typeof resolved.properties === "object") {
      return `${name}{${Object.keys(resolved.properties as Json).sort().join(", ")}}`;
    }
    return name;
  }
  if (typeof n.type === "string") {
    if (n.type === "array") return `array<${describeType(n.items, doc)}>`;
    if (n.type === "object" && n.properties && typeof n.properties === "object") {
      return `object{${Object.keys(n.properties as Json).sort().join(",")}}`;
    }
    return n.type;
  }
  return "schema";
}

function resolveRef(doc: Json | undefined, ref: string): Json | undefined {
  if (!doc || !ref.startsWith("#/")) return undefined;
  let cur: unknown = doc;
  for (const part of ref.slice(2).split("/")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Json)[part];
  }
  return cur && typeof cur === "object" ? (cur as Json) : undefined;
}

function successorLabel(name: string, prop: unknown, doc: Json): string {
  const n = prop && typeof prop === "object" ? (prop as Json) : undefined;
  if (n?.type === "array") {
    const items = describeType(n.items, doc);
    if (items.startsWith("Identifier{") || items.includes("{")) {
      return `\`${name}[]\` {${items.replace(/^[^{]*\{/, "").replace(/\}$/, "")}}`;
    }
    return `\`${name}[]\``;
  }
  return `\`${name}\``;
}

function xReplaces(prop: unknown): string | undefined {
  if (!prop || typeof prop !== "object") return undefined;
  const v = (prop as Json)["x-replaces"];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Prefer a producer clone at baseline; fall back to the vendored snapshot (stub, no network). */
export function resolveV2Path(producerSlug: string, snapshot = V2_SPEC_PATH): string {
  const clone = join(WORKSPACES_DIR, producerSlug, "openapi.yaml");
  return existsSync(clone) ? clone : snapshot;
}

export function defaultV3Path(): string {
  return V3_SPEC_PATH;
}

type SchemaDiff = {
  name: string;
  changes: BreakingChange[];
  added: string[];
  unchanged: string[];
  addedByReplaces: Map<string, string[]>;
  props3: Json;
};

function diffOneSchema(name: string, s2: Json, s3: Json, v2: Json, v3: Json): SchemaDiff {
  const keys2 = propKeys(s2);
  const keys3 = propKeys(s3);
  const props2 = (s2.properties ?? {}) as Json;
  const props3 = (s3.properties ?? {}) as Json;

  const added = keys3.filter((k) => !keys2.includes(k));
  const removed = keys2.filter((k) => !keys3.includes(k));
  const shared = keys2.filter((k) => keys3.includes(k));
  const typeChanged = shared.filter((k) => !deepEqual(props2[k], props3[k]));
  const unchanged = shared.filter((k) => deepEqual(props2[k], props3[k]));

  const changes: BreakingChange[] = [
    ...removed.map((field) => ({
      field,
      kind: "removed" as const,
      from: describeType(props2[field], v2),
      to: "absent",
      schema: name,
    })),
    ...typeChanged.map((field) => ({
      field,
      kind: "type_changed" as const,
      from: describeType(props2[field], v2),
      to: describeType(props3[field], v3),
      schema: name,
    })),
  ];

  const addedByReplaces = new Map<string, string[]>();
  for (const key of added) {
    const old = xReplaces(props3[key]);
    if (!old) continue;
    const list = addedByReplaces.get(old) ?? [];
    list.push(key);
    addedByReplaces.set(old, list);
  }

  return { name, changes, added, unchanged, addedByReplaces, props3 };
}

/**
 * Structural OpenAPI schema diff. Breaking = removed or type-changed
 * properties on shared component object schemas. Purely added properties are
 * recorded and excluded from `fields`. Path changes are noted, not fatal.
 */
export function diffOpenApi(v2Path: string, v3Path: string): DiffResult {
  const v2 = loadYaml(v2Path);
  const v3 = loadYaml(v3Path);

  const schemas2 = objectSchemas(v2);
  const schemas3 = objectSchemas(v3);
  const sharedNames = Object.keys(schemas2).filter((n) => n in schemas3);
  if (sharedNames.length === 0) {
    throw new Error(
      `OpenAPI pair has no shared object schemas under components.schemas (${v2Path} → ${v3Path})`,
    );
  }

  const perSchema = sharedNames.map((name) =>
    diffOneSchema(name, schemas2[name]!, schemas3[name]!, v2, v3),
  );
  const withBreaks = perSchema.filter((s) => s.changes.length > 0);
  const refs = schemaRefCounts(v2);
  withBreaks.sort((a, b) => (refs.get(b.name) ?? 0) - (refs.get(a.name) ?? 0));

  const focus =
    withBreaks.length <= 1
      ? withBreaks[0]
      : withBreaks.reduce((best, cur) =>
          (refs.get(cur.name) ?? 0) > (refs.get(best.name) ?? 0) ? cur : best,
        );

  if (!focus) {
    throw new Error(`diff of ${v2Path} → ${v3Path} found no breaking schema fields`);
  }

  const prefix = withBreaks.length > 1;
  const label = (c: BreakingChange) => (prefix ? `${c.schema}.${c.field}` : c.field);
  const changes = focus.changes.map((c) => ({ ...c, field: label(c) }));
  const fields = changes.map((c) => c.field);
  const added = prefix ? focus.added.map((k) => `${focus.name}.${k}`) : focus.added;
  const unchanged = prefix
    ? focus.unchanged.map((k) => `${focus.name}.${k}`)
    : focus.unchanged;

  const pairedAdded = new Set([...focus.addedByReplaces.values()].flat());
  const unpairedAdded = focus.added.filter((k) => !pairedAdded.has(k));

  const changeLines = focus.changes.map((c, i) => {
    const field = label(c);
    if (c.kind === "type_changed") {
      return `${i + 1}. \`${field}\` type changed: ${c.from} → ${c.to}.`;
    }
    const successors = (focus.addedByReplaces.get(c.field) ?? []).sort(
      (a, b) => Object.keys(focus.props3).indexOf(a) - Object.keys(focus.props3).indexOf(b),
    );
    if (successors.length) {
      const labels = successors.map((s) => successorLabel(s, focus.props3[s], v3));
      return `${i + 1}. \`${field}\` → ${labels.join(" / ")} (${c.from} replaced).`;
    }
    return `${i + 1}. \`${field}\` removed: ${c.from} → absent (no successor).`;
  });

  const v2Paths = Object.keys((v2.paths ?? {}) as Json).sort();
  const v3Paths = Object.keys((v3.paths ?? {}) as Json).sort();
  const pathNote = deepEqual(v2Paths, v3Paths)
    ? `URL paths unchanged: ${v2Paths.join(", ") || "(none)"}.`
    : `URL paths changed: ${v2Paths.join(", ") || "(none)"} → ${v3Paths.join(", ") || "(none)"}.`;

  const otherBreaks = withBreaks.filter((s) => s.name !== focus.name);
  const otherNote =
    otherBreaks.length > 0
      ? `Also breaking on ${otherBreaks.map((s) => `${s.name} (${s.changes.map((c) => c.field).join(", ")})`).join("; ")}.`
      : undefined;

  const summary = [
    `Breaking ${focus.name} fields (${fields.length}):`,
    ...changeLines,
    "",
    unchanged.length ? `Unchanged: ${unchanged.join(", ")}.` : "Unchanged: (none).",
    unpairedAdded.length
      ? `Added (not a replacement): ${unpairedAdded.join(", ")}.`
      : undefined,
    otherNote,
    pathNote,
    `Diffed ${v2Path} → ${v3Path}.`,
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  return { v2Path, v3Path, changes, fields, added, unchanged, summary };
}

/** Convenience: bundled spec pair when ENGAGE paths are omitted. */
export function diffDefaultPair(producerSlug: string): DiffResult {
  return diffOpenApi(resolveV2Path(producerSlug), defaultV3Path());
}
