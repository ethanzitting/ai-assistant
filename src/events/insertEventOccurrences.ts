import { buildOccurrenceSchedule } from "@/events/buildOccurrenceSchedule.ts";

export async function insertEventOccurrences(
  sql: any,
  eventId: string,
  eventAt: string,
  reminderOffsetsMinutes: number[],
): Promise<void> {
  for (
    const { offsetMinutes, dueAt } of buildOccurrenceSchedule(
      eventAt,
      reminderOffsetsMinutes,
    )
  ) {
    const occurrences = await sql`
      INSERT INTO event_occurrences (event_id, due_at, event_at, offset_minutes)
      VALUES (${eventId}, ${dueAt}, ${eventAt}, ${offsetMinutes})
      ON CONFLICT (event_id, due_at) DO NOTHING
      RETURNING id
    `;
    if (occurrences.length === 0) continue;

    await sql`
      INSERT INTO reminders (event_id, occurrence_id, remind_at)
      VALUES (${eventId}, ${occurrences[0].id}, ${dueAt})
      ON CONFLICT DO NOTHING
    `;
  }
}
