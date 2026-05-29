import { db } from "@/db.ts";
import type { ToolResult } from "@/tools/toolTypes.ts";
import { trace } from "@/trace.ts";

export async function storePreference(
  input: Record<string, unknown>,
  traceId: string,
): Promise<ToolResult> {
  const key = input.key as string;
  const value = input.value;

  if (!key) {
    return { content: `Missing required field: key. Provide a string key for the preference.`, isError: true };
  }

  await db`
    INSERT INTO preferences (key, value, source)
    VALUES (${key}, ${JSON.stringify(value)}, 'explicit')
    ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(value)}, updated_at = now()
  `;

  await trace(traceId, "db.insert", { table: "preferences", key, op: "upsert" });
  return { content: `Stored preference: ${key} = ${JSON.stringify(value)}` };
}
