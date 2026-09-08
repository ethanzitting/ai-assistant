import { insertEventOccurrences } from "@/events/insertEventOccurrences.ts";

interface ReplaceOpenEventScheduleOptions {
  sql: any;
  eventId: string;
  eventAt: string;
  reminderOffsetsMinutes: number[];
}

export async function replaceOpenEventSchedule(
  options: ReplaceOpenEventScheduleOptions,
): Promise<void> {
  const { sql, eventId, eventAt, reminderOffsetsMinutes } = options;
  await sql`
    UPDATE reminders SET status = 'cancelled', claimed_at = NULL
    WHERE event_id = ${eventId} AND status IN ('pending', 'sending')
  `;
  await sql`
    UPDATE event_occurrences SET status = 'resolved', resolved_at = now()
    WHERE event_id = ${eventId} AND status IN ('pending', 'unresolved')
  `;
  await insertEventOccurrences(sql, eventId, eventAt, reminderOffsetsMinutes);
}
