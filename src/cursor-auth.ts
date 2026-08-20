import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Live agents take CURSOR_API_KEY, or the key Cursor.auth.login wrote to
 * ~/.cursor/sdk/auth.json. Never log the value.
 */
export function cursorApiKey(): string | undefined {
  const fromEnv = process.env.CURSOR_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const path = join(homedir(), ".cursor", "sdk", "auth.json");
  if (!existsSync(path)) return undefined;
  try {
    const auth = JSON.parse(readFileSync(path, "utf8")) as {
      apiKey?: string;
      apiKeyExpiresAtMs?: number;
    };
    if (!auth.apiKey) return undefined;
    if (typeof auth.apiKeyExpiresAtMs === "number" && auth.apiKeyExpiresAtMs < Date.now()) {
      return undefined;
    }
    return auth.apiKey;
  } catch {
    return undefined;
  }
}

export function liveEnabled(): boolean {
  return Boolean(cursorApiKey());
}
