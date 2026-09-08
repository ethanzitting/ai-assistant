import { db } from "@/db.ts";

export interface ClaimedReminder {
  id: string;
  occurrence_id: string;
  event_id: string;
  title: string;
  event_type: string;
  priority: "high" | "medium" | "low";
  timezone: string;
  due_at: Date;
  event_at: Date;
  offset_minutes: number;
}

export async function claimDueReminders(): Promise<ClaimedReminder[]> {
  await db`
    UPDATE reminders
    SET status = 'pending', claimed_at = NULL
    WHERE status = 'sending' AND claimed_at < now() - interval '10 minutes'
  `;

  return await db`
    WITH due AS (
      SELECT r.id
      FROM reminders r
      JOIN event_occurrences o ON o.id = r.occurrence_id
      JOIN events e ON e.id = r.event_id
      WHERE r.status = 'pending'
        AND r.remind_at <= now()
        AND o.status <> 'resolved'
        AND e.status = 'active'
      ORDER BY r.remind_at
      LIMIT 25
      FOR UPDATE OF r SKIP LOCKED
    )
    UPDATE reminders r
    SET status = 'sending', claimed_at = now(), attempt_count = attempt_count + 1
    FROM due, event_occurrences o, events e
    WHERE r.id = due.id AND o.id = r.occurrence_id AND e.id = r.event_id
    RETURNING r.id, r.occurrence_id, r.event_id, e.title, e.type AS event_type, e.priority,
      e.timezone, o.due_at, o.event_at, o.offset_minutes
  ` as unknown as ClaimedReminder[];
}
