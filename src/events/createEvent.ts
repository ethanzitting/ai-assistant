import { db } from "@/db.ts";
import { computeNextDueAt } from "@/events/computeNextDueAt.ts";
import type { EventData } from "@/events/manageEventsSchema.ts";
import type { ToolResult } from "@/tools/toolTypes.ts";
import { trace } from "@/trace.ts";

export async function createEvent(
  event: EventData,
  traceId: string,
): Promise<ToolResult> {
  const recurrenceRule = event.recurrence_rule
    ? JSON.stringify(event.recurrence_rule)
    : null;

  const result = await db`
    INSERT INTO events (title, type, priority, dtstart, dtend, deadline,
      lead_time_days, recurrence_rule, category, next_due_at)
    VALUES (
      ${event.title},
      ${event.type},
      ${event.priority ?? "medium"},
      ${event.dtstart ?? null},
      ${event.dtend ?? null},
      ${event.deadline ?? null},
      ${event.lead_time_days ?? null},
      ${recurrenceRule},
      ${event.category ?? null},
      ${computeNextDueAt(event)}
    )
    RETURNING id, title
  `;

  await trace(traceId, "db.insert", { table: "events", id: result[0].id, title: result[0].title });
  return { content: `Created event "${result[0].title}" (id: ${result[0].id}).` };
}
