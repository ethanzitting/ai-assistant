import { db } from "@/database.ts";
import { computeNextDueAt } from "@/events/computeNextDueAt.ts";
import type { ToolResult } from "@/tools/toolTypes.ts";

export async function createEvent(
  eventData: Record<string, unknown>,
): Promise<ToolResult> {
  const recurrenceRule = eventData.recurrence_rule
    ? JSON.stringify(eventData.recurrence_rule)
    : null;

  const result = await db`
    INSERT INTO events (title, type, priority, dtstart, dtend, deadline,
      lead_time_days, recurrence_rule, category, next_due_at)
    VALUES (
      ${eventData.title as string},
      ${eventData.type as string},
      ${(eventData.priority as string) ?? "medium"},
      ${(eventData.dtstart as string) ?? null},
      ${(eventData.dtend as string) ?? null},
      ${(eventData.deadline as string) ?? null},
      ${(eventData.lead_time_days as number) ?? null},
      ${recurrenceRule},
      ${(eventData.category as string) ?? null},
      ${computeNextDueAt(eventData)}
    )
    RETURNING id, title
  `;

  return { content: `Created event "${result[0].title}" (id: ${result[0].id}).` };
}
