import { db } from "@/database.ts";
import type { ToolResult } from "@/tools/toolTypes.ts";

export async function listEvents(
  filter: Record<string, unknown>,
): Promise<ToolResult> {
  const status = (filter.status as string) ?? "active";
  const fromDate = filter.from as string | undefined;
  const toDate = filter.to as string | undefined;

  let results;

  if (fromDate && toDate) {
    results = await db`
      SELECT id, title, type, priority, status, dtstart, deadline, next_due_at, category
      FROM events
      WHERE status = ${status} AND next_due_at >= ${fromDate} AND next_due_at <= ${toDate}
      ORDER BY next_due_at ASC NULLS LAST
      LIMIT 50
    `;
  } else {
    results = await db`
      SELECT id, title, type, priority, status, dtstart, deadline, next_due_at, category
      FROM events
      WHERE status = ${status}
      ORDER BY next_due_at ASC NULLS LAST
      LIMIT 50
    `;
  }

  if (results.length === 0) {
    return { content: `No events found with status "${status}".` };
  }

  const formatted = results.map((event: Record<string, unknown>) => {
    const dueDate = event.next_due_at ?? event.deadline ?? event.dtstart ?? "no date";
    return `- ${event.title} [${event.type}/${event.priority}] due: ${dueDate} (id: ${event.id})`;
  });

  return { content: formatted.join("\n") };
}
