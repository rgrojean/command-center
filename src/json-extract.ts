/**
 * Agents are told "JSON only, no fences" and still narrate, fence, or append
 * a trailing `}`. Parse the first complete object; ignore leftover closers.
 */
import { isCreditsError } from "./concurrency.js";

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
  return parseJsonSlice(slice);
}

function parseJsonSlice(slice: string): unknown {
  try {
    return JSON.parse(slice);
  } catch (first) {
    const relaxed = slice.replace(/,\s*([\]}])/g, "$1");
    if (relaxed !== slice) {
      try {
        return JSON.parse(relaxed);
      } catch {
        /* keep the original SyntaxError */
      }
    }
    throw first;
  }
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

/** Short operator-facing reason; keep the original Error.message for logs. */
export function describeAgentFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (isCreditsError(err)) return "out of Cursor credits";
  if (/did not contain a complete JSON object/i.test(message)) return "incomplete JSON in output";
  if (/did not contain a JSON object/i.test(message)) return "no JSON object in output";
  if (/JSON at position|Expected ',' or '\]'|Expected ',' or '\}'|Unexpected token/i.test(message)) {
    return "malformed JSON in output";
  }
  if (/Agent\.create timed out|agent\.send timed out/i.test(message)) {
    return "cloud agent startup timed out";
  }
  if (/SDK startup failed/i.test(message)) {
    const inner = message.replace(/^SDK startup failed[^:]*:\s*/i, "").trim();
    return inner && inner.length <= 140 ? `startup: ${inner}` : "SDK startup failed";
  }
  if (/ZodError|invalid_type|Required/i.test(message)) return "output failed schema validation";
  return message.length > 140 ? `${message.slice(0, 137)}…` : message;
}

export function assistantTextFromEvents(
  events: Array<{ type: string; text?: string }>,
): string {
  return events
    .filter((e) => e.type === "assistant" && e.text)
    .map((e) => e.text)
    .join("");
}
