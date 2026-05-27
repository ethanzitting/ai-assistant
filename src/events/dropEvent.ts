import { db } from "@/db.ts";
import type { ToolResult } from "@/tools/toolTypes.ts";

export async function dropEvent(eventId: string): Promise<ToolResult> {
  const result = await db`
    UPDATE events SET status = 'dropped'
    WHERE id = ${eventId} AND status = 'active'
    RETURNING title
  `;

  if (result.length === 0) {
    return { content: `No active event found with id ${eventId}.`, isError: true };
  }

  return { content: `Dropped "${result[0].title}".` };
}
