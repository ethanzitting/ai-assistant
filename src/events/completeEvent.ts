import { db } from "@/db.ts";
import { computeNextDueAt } from "@/events/computeNextDueAt.ts";
import type { ToolResult } from "@/tools/toolTypes.ts";
import { trace } from "@/trace.ts";

export async function completeEvent(eventId: string, traceId: string): Promise<ToolResult> {
  const result = await db`
    UPDATE events
    SET status = 'completed', last_completed_at = now()
    WHERE id = ${eventId} AND status = 'active'
    RETURNING id, title, recurrence_rule
  `;

  if (result.length === 0) {
    return { content: `No active event found with id ${eventId}.`, isError: true };
  }

  const completedEvent = result[0];
  await trace(traceId, "db.update", { table: "events", id: eventId, op: "complete", title: completedEvent.title });

  if (completedEvent.recurrence_rule) {
    await advanceRecurrence(eventId, completedEvent.recurrence_rule, traceId);
    return { content: `Completed "${completedEvent.title}" and scheduled next occurrence.` };
  }

  return { content: `Completed "${completedEvent.title}".` };
}

async function advanceRecurrence(
  eventId: string,
  recurrenceRule: Record<string, unknown>,
  traceId: string,
): Promise<void> {
  const nextDueAt = computeNextDueAt({ recurrence_rule: recurrenceRule });
  if (!nextDueAt) return;

  await db`
    UPDATE events
    SET status = 'active', next_due_at = ${nextDueAt}
    WHERE id = ${eventId}
  `;
  await trace(traceId, "db.update", { table: "events", id: eventId, op: "advance_recurrence", nextDueAt });
}
