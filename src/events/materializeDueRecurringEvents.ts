import { db } from "@/db.ts";
import { computeNextDueAt } from "@/events/computeNextDueAt.ts";
import { insertEventOccurrences } from "@/events/insertEventOccurrences.ts";
import type { RecurrenceRule } from "@/events/manageEventsSchema.ts";
import { warn } from "@/logger.ts";

interface DueRecurringEvent {
  id: string;
  next_due_at: Date;
  recurrence_rule: RecurrenceRule;
  timezone: string;
}

export async function materializeDueRecurringEvents(): Promise<number> {
  const dueEvents = await db`
    SELECT id, next_due_at, recurrence_rule, timezone
    FROM events
    WHERE status = 'active'
      AND type = 'fixed_recurring'
      AND next_due_at <= now()
    ORDER BY next_due_at
  ` as unknown as DueRecurringEvent[];

  let materialized = 0;
  for (const event of dueEvents) {
    try {
      materialized += await materializeEvent(event);
    } catch (err: unknown) {
      warn("reminder", "Could not advance recurring event", {
        eventId: event.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return materialized;
}

async function materializeEvent(event: DueRecurringEvent): Promise<number> {
  let inserted = 0;
  await db.begin(async (tx) => {
    const [locked] = await tx`
      SELECT next_due_at, recurrence_rule, timezone
      FROM events
      WHERE id = ${event.id} AND status = 'active'
        AND type = 'fixed_recurring' AND next_due_at <= now()
      FOR UPDATE
    `;
    if (!locked) return;

    const scheduledAt = (locked.next_due_at as Date).toISOString();
    const [openOccurrence] = await tx`
      SELECT id FROM event_occurrences
      WHERE event_id = ${event.id} AND status IN ('pending', 'unresolved')
      LIMIT 1
    `;

    if (!openOccurrence) {
      await insertEventOccurrences(tx, event.id, scheduledAt, [0]);
      inserted = 1;
    }

    const lockedEvent = {
      ...event,
      next_due_at: locked.next_due_at as Date,
      recurrence_rule: locked.recurrence_rule as RecurrenceRule,
      timezone: locked.timezone as string,
    };
    await tx`
      UPDATE events
      SET next_due_at = ${nextFutureOccurrence(lockedEvent, scheduledAt)}
      WHERE id = ${event.id}
    `;
  });
  return inserted;
}

function nextFutureOccurrence(
  event: DueRecurringEvent,
  scheduledAt: string,
): string {
  if (
    !Number.isInteger(event.recurrence_rule.interval) ||
    event.recurrence_rule.interval < 1
  ) {
    throw new Error(`Event ${event.id} has an invalid recurrence interval.`);
  }
  let next = computeNextDueAt(
    event.recurrence_rule,
    scheduledAt,
    event.timezone,
  );
  const now = Temporal.Now.instant();
  for (
    let advances = 0;
    Temporal.Instant.compare(Temporal.Instant.from(next), now) <= 0;
    advances++
  ) {
    if (advances >= 10_000) {
      throw new Error(
        `Event ${event.id} recurrence is too far behind to advance safely.`,
      );
    }
    next = computeNextDueAt(event.recurrence_rule, next, event.timezone);
  }
  return next;
}
