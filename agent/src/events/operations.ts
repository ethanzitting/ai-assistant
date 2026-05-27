import { db } from "@/db.ts";
import { computeNextDueAt } from "@/events/recurrence.ts";
import type { ToolResult } from "@/tools/types.ts";

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

export async function updateEvent(
  eventId: string,
  eventData: Record<string, unknown>,
): Promise<ToolResult> {
  const setClauses: string[] = [];
  const allowedFields = [
    "title", "type", "priority", "dtstart", "dtend",
    "deadline", "lead_time_days", "category", "status",
  ];

  for (const field of allowedFields) {
    if (field in eventData) {
      setClauses.push(field);
    }
  }

  if (setClauses.length === 0) {
    return { content: "No valid fields to update.", isError: true };
  }

  await db`
    UPDATE events SET
      title = COALESCE(${(eventData.title as string) ?? null}, title),
      priority = COALESCE(${(eventData.priority as string) ?? null}, priority),
      dtstart = COALESCE(${(eventData.dtstart as string) ?? null}, dtstart),
      dtend = COALESCE(${(eventData.dtend as string) ?? null}, dtend),
      deadline = COALESCE(${(eventData.deadline as string) ?? null}, deadline),
      category = COALESCE(${(eventData.category as string) ?? null}, category)
    WHERE id = ${eventId}
  `;

  return { content: `Updated event ${eventId}.` };
}

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

export async function completeEvent(eventId: string): Promise<ToolResult> {
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

  if (completedEvent.recurrence_rule) {
    await advanceRecurrence(eventId, completedEvent.recurrence_rule);
    return { content: `Completed "${completedEvent.title}" and scheduled next occurrence.` };
  }

  return { content: `Completed "${completedEvent.title}".` };
}

async function advanceRecurrence(
  eventId: string,
  recurrenceRule: Record<string, unknown>,
): Promise<void> {
  const nextDueAt = computeNextDueAt({ recurrence_rule: recurrenceRule });
  if (!nextDueAt) return;

  await db`
    UPDATE events
    SET status = 'active', next_due_at = ${nextDueAt}
    WHERE id = ${eventId}
  `;
}

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
