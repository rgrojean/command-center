/**
 * Agents are told "JSON only, no fences" and still narrate, fence, or append
 * a trailing `}`. Parse the first complete object; ignore leftover closers.
 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("{");
  if (start < 0) {
    throw new Error("agent output did not contain a JSON object");
  }
  const slice = firstObjectSlice(raw, start);
  if (!slice) {
    throw new Error("agent output did not contain a complete JSON object");
  }
  return JSON.parse(slice);
}

/** First `{` … matching `}`, respecting strings. Trailing text is ignored. */
export function firstObjectSlice(raw: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return undefined;
}

export function assistantTextFromEvents(
  events: Array<{ type: string; text?: string }>,
): string {
  return events
    .filter((e) => e.type === "assistant" && e.text)
    .map((e) => e.text)
    .join("");
}
