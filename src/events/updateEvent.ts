import { db } from "@/db.ts";
import type { EventDataPartial } from "@/events/manageEventsSchema.ts";
import type { ToolResult } from "@/tools/toolTypes.ts";
import { trace } from "@/trace.ts";

export async function updateEvent(
  eventId: string,
  event: EventDataPartial,
  traceId: string,
): Promise<ToolResult> {
  const updatedFields = Object.keys(event).filter((k) => event[k as keyof typeof event] !== undefined);

  if (updatedFields.length === 0) {
    return { content: "No valid fields to update.", isError: true };
  }

  await db`
    UPDATE events SET
      title = COALESCE(${event.title ?? null}, title),
      priority = COALESCE(${event.priority ?? null}, priority),
      dtstart = COALESCE(${event.dtstart ?? null}, dtstart),
      dtend = COALESCE(${event.dtend ?? null}, dtend),
      deadline = COALESCE(${event.deadline ?? null}, deadline),
      category = COALESCE(${event.category ?? null}, category)
    WHERE id = ${eventId}
  `;

  await trace(traceId, "db.update", { table: "events", id: eventId, fields: updatedFields });
  return { content: `Updated event ${eventId}.` };
}
