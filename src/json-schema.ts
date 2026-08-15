import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/** Inline JSON Schema for prompt injection — $refs would force the agent to chase definitions. */
export function schemaToPromptJson(schema: z.ZodType, name: string): string {
  return JSON.stringify(
    zodToJsonSchema(schema, { name, $refStrategy: "none" }),
    null,
    2,
  );
}
