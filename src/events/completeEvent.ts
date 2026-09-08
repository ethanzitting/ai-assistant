import { db } from "@/db.ts";
import { computeNextDueAt } from "@/events/computeNextDueAt.ts";
import { insertEventOccurrences } from "@/events/insertEventOccurrences.ts";
import type { RecurrenceRule } from "@/events/manageEventsSchema.ts";
import type { ToolResult } from "@/tools/toolTypes.ts";
import { trace } from "@/trace.ts";

interface ActiveEvent {
  id: string;
  title: string;
  type: string;
  recurrence_rule: RecurrenceRule | null;
  timezone: string;
}

export async function completeEvent(
  eventId: string,
  traceId: string,
): Promise<ToolResult> {
  let resolved = false;
  let event: ActiveEvent | undefined;

  await db.begin(async (tx) => {
    const rows = await tx`
      SELECT id, title, type, recurrence_rule, timezone
      FROM events WHERE id = ${eventId} AND status = 'active'
      FOR UPDATE
    `;
    event = rows[0] as unknown as ActiveEvent | undefined;
    if (!event) return;

    const occurrences = await tx`
      UPDATE event_occurrences
      SET status = 'resolved', resolved_at = now()
      WHERE id = (
        SELECT id FROM event_occurrences
        WHERE event_id = ${eventId} AND status IN ('pending', 'unresolved')
        ORDER BY notified_at DESC NULLS LAST, due_at
        LIMIT 1
      )
      RETURNING id
    `;
    if (occurrences.length === 0) return;
    resolved = true;

    await tx`
      UPDATE reminders SET status = 'cancelled', claimed_at = NULL
      WHERE occurrence_id = ${
      occurrences[0].id
    } AND status IN ('pending', 'sending')
    `;
    await advanceAfterResolution(tx, event);
  });

  if (!event) {
    return {
      content: `No active reminder found with id ${eventId}.`,
      isError: true,
    };
  }
  if (!resolved) {
    return {
      content: `No unresolved occurrence found for "${event.title}".`,
      isError: true,
    };
  }

  await trace(traceId, "db.update", {
    table: "event_occurrences",
    eventId,
    op: "resolve",
  });
  return { content: `Resolved the current occurrence of "${event.title}".` };
}

async function advanceAfterResolution(
  sql: any,
  event: ActiveEvent,
): Promise<void> {
  if (event.type === "interval_recurring" && event.recurrence_rule) {
    const nextDueAt = computeNextDueAt(
      event.recurrence_rule,
      new Date(),
      event.timezone,
    );
    await insertEventOccurrences(sql, event.id, nextDueAt, [0]);
    await sql`UPDATE events SET last_completed_at = now() WHERE id = ${event.id}`;
    return;
  }

  if (event.type === "fixed_recurring") {
    await sql`UPDATE events SET last_completed_at = now() WHERE id = ${event.id}`;
    return;
  }

  const [remaining] = await sql`
    SELECT id FROM event_occurrences
    WHERE event_id = ${event.id} AND status IN ('pending', 'unresolved')
    LIMIT 1
  `;
  await sql`
    UPDATE events
    SET status = ${
    remaining ? "active" : "completed"
  }, last_completed_at = now()
    WHERE id = ${event.id}
  `;
}
