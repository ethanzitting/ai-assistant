import { db } from "@/db.ts";
import { eventToolResult } from "@/events/eventToolResult.ts";
import type { ToolResult } from "@/tools/toolTypes.ts";
import { trace } from "@/trace.ts";

export async function dismissEvent(
  eventId: string,
  traceId: string,
): Promise<ToolResult> {
  const rows = await db`
    UPDATE events SET status = 'dismissed', next_due_at = NULL
    WHERE id = ${eventId} AND status = 'missed'
    RETURNING title
  `;
  const title = rows[0]?.title as string | undefined;

  if (!title) {
    return eventToolResult({
      operation: "dismiss",
      changed: false,
      eventId,
      reason: "no_missed_event",
    });
  }

  await trace(traceId, "db.update", {
    table: "events",
    id: eventId,
    op: "dismiss",
    title,
  });
  return eventToolResult({
    operation: "dismiss",
    changed: true,
    eventId,
    title,
    status: "dismissed",
  });
}
