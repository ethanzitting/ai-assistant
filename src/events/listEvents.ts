import { db } from "@/db.ts";
import type { EventFilter } from "@/events/manageEventsSchema.ts";
import type { ToolResult } from "@/tools/toolTypes.ts";

interface ListedEvent {
  id: string;
  title: string;
  type: string;
  priority: string;
  status: string;
  due_at: Date | null;
  occurrence_status: string | null;
  timezone: string;
  recurrence_rule: Record<string, unknown> | null;
}

export async function listEvents(filter: EventFilter): Promise<ToolResult> {
  const status = filter.status ?? "active";
  const from = filter.from ?? null;
  const to = filter.to ?? null;
  const type = filter.type ?? null;

  const results = await db`
    SELECT e.id, e.title, e.type, e.priority, e.status, e.timezone, e.recurrence_rule,
      COALESCE(current_occurrence.due_at, e.next_due_at) AS due_at,
      current_occurrence.status AS occurrence_status
    FROM events e
    LEFT JOIN LATERAL (
      SELECT due_at, status
      FROM event_occurrences
      WHERE event_id = e.id AND status IN ('pending', 'unresolved')
      ORDER BY notified_at DESC NULLS LAST, due_at
      LIMIT 1
    ) current_occurrence ON true
    WHERE e.status = ${status}
      AND (${type}::text IS NULL OR e.type = ${type})
      AND (${from}::timestamptz IS NULL OR COALESCE(current_occurrence.due_at, e.next_due_at) >= ${from})
      AND (${to}::timestamptz IS NULL OR COALESCE(current_occurrence.due_at, e.next_due_at) <= ${to})
    ORDER BY due_at ASC NULLS LAST
    LIMIT 50
  ` as unknown as ListedEvent[];

  if (results.length === 0) {
    return { content: `No reminders found with status "${status}".` };
  }
  return {
    content: results.map((event) => {
      const dueAt = event.due_at?.toISOString() ?? "no current occurrence";
      const occurrence = event.occurrence_status
        ? `/${event.occurrence_status}`
        : "";
      return `- ${event.title} [${event.type}/${event.priority}${occurrence}] due: ${dueAt} (${event.timezone}) (id: ${event.id})`;
    }).join("\n"),
  };
}
