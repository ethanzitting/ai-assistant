import { db } from "@/db.ts";
import { eventToolResult } from "@/events/eventToolResult.ts";
import type { ToolResult } from "@/tools/toolTypes.ts";
import { trace } from "@/trace.ts";

export async function dropEvent(
  eventId: string,
  traceId: string,
): Promise<ToolResult> {
  let title: string | undefined;
  await db.begin(async (tx) => {
    const result = await tx`
      UPDATE events SET status = 'dropped', next_due_at = NULL
      WHERE id = ${eventId} AND status = 'active'
      RETURNING title
    `;
    title = result[0]?.title as string | undefined;
    if (!title) return;

    await tx`
      UPDATE event_occurrences SET status = 'resolved', resolved_at = now()
      WHERE event_id = ${eventId} AND status IN ('pending', 'unresolved')
    `;
    await tx`
      UPDATE reminders SET status = 'cancelled', claimed_at = NULL
      WHERE event_id = ${eventId} AND status IN ('pending', 'sending')
    `;
  });

  if (!title) {
    return eventToolResult({
      operation: "drop",
      changed: false,
      eventId,
      reason: "no_active_event",
    });
  }

  await trace(traceId, "db.update", {
    table: "events",
    id: eventId,
    op: "drop",
    title,
  });
  return eventToolResult({
    operation: "drop",
    changed: true,
    eventId,
    title,
    status: "dropped",
  });
}
