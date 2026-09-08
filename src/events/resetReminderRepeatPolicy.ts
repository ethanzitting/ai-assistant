export async function resetReminderRepeatPolicy(
  sql: any,
  eventId: string,
  priority: string,
): Promise<void> {
  await sql`
    UPDATE reminders r SET status = 'cancelled', claimed_at = NULL
    FROM event_occurrences o
    WHERE r.occurrence_id = o.id AND o.event_id = ${eventId}
      AND o.status = 'unresolved' AND r.status IN ('pending', 'sending')
  `;
  if (priority !== "high") return;

  await sql`
    INSERT INTO reminders (event_id, occurrence_id, remind_at)
    SELECT ${eventId}, id, now() + interval '2 hours'
    FROM event_occurrences
    WHERE event_id = ${eventId} AND status = 'unresolved'
    ORDER BY notified_at DESC NULLS LAST LIMIT 1
    ON CONFLICT DO NOTHING
  `;
}
