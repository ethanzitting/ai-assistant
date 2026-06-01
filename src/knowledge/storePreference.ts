import { db } from "@/db.ts";
import type { PreferenceInput } from "@/knowledge/rememberSchema.ts";
import type { ToolResult } from "@/tools/toolTypes.ts";
import { trace } from "@/trace.ts";

export async function storePreference(
  input: PreferenceInput,
  traceId: string,
): Promise<ToolResult> {
  const { key, value } = input;

  await db`
    INSERT INTO preferences (key, value, source)
    VALUES (${key}, ${db.json(value as never)}, 'explicit')
    ON CONFLICT (key) DO UPDATE SET value = ${db.json(value as never)}, updated_at = now()
  `;

  await trace(traceId, "db.insert", { table: "preferences", key, op: "upsert" });
  return { content: `Stored preference: ${key} = ${JSON.stringify(value)}` };
}
