import { db } from "@/db.ts";
import type { ToolResult } from "@/tools/toolTypes.ts";

export async function storePreference(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const key = input.key as string;
  const value = input.value;

  await db`
    INSERT INTO preferences (key, value, source)
    VALUES (${key}, ${JSON.stringify(value)}, 'explicit')
    ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(value)}, updated_at = now()
  `;

  return { content: `Stored preference: ${key} = ${JSON.stringify(value)}` };
}
