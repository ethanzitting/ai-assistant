import { db } from "@/db.ts";
import { computeNextDueAt } from "@/events/computeNextDueAt.ts";
import { eventToolResult } from "@/events/eventToolResult.ts";
import type { EventDataPartial } from "@/events/manageEventsSchema.ts";
import { prepareEventData } from "@/events/prepareEventData.ts";
import { replaceOpenEventSchedule } from "@/events/replaceOpenEventSchedule.ts";
import { resetReminderRepeatPolicy } from "@/events/resetReminderRepeatPolicy.ts";
import { storedEventToData } from "@/events/storedEventToData.ts";
import type { ToolResult } from "@/tools/toolTypes.ts";
import { trace } from "@/trace.ts";

const scheduleFields = new Set([
  "type",
  "dtstart",
  "deadline",
  "lead_time_days",
  "reminder_offsets_minutes",
  "recurrence_rule",
  "timezone",
]);

export async function updateEvent(
  eventId: string,
  changes: EventDataPartial,
  traceId: string,
): Promise<ToolResult> {
  const changedFields = Object.keys(changes).filter((key) =>
    changes[key as keyof typeof changes] !== undefined
  );
  if (changedFields.length === 0) {
    return eventToolResult({
      operation: "update",
      changed: false,
      eventId,
      reason: "no_valid_fields",
    });
  }

  let title: string | undefined;
  try {
    await db.begin(async (tx) => {
      const [stored] =
        await tx`SELECT * FROM events WHERE id = ${eventId} AND status = 'active' FOR UPDATE`;
      if (!stored) return;

      const merged = { ...storedEventToData(stored), ...changes };
      if (
        changes.lead_time_days !== undefined &&
        changes.reminder_offsets_minutes === undefined
      ) {
        merged.reminder_offsets_minutes = undefined;
      }
      const prepared = prepareEventData(merged);
      title = prepared.title;
      const rebuildSchedule = changedFields.some((field) =>
        scheduleFields.has(field)
      );
      const eventAt = prepared.type === "deadline"
        ? prepared.deadline!
        : prepared.dtstart!;
      const nextDueAt = rebuildSchedule
        ? prepared.type === "fixed_recurring"
          ? computeNextDueAt(
            prepared.recurrence_rule!,
            eventAt,
            prepared.timezone,
          )
          : null
        : stored.next_due_at;

      await tx`
        UPDATE events SET title = ${prepared.title}, type = ${prepared.type},
          priority = ${prepared.priority ?? "medium"}, dtstart = ${
        prepared.dtstart ?? null
      },
          dtend = ${prepared.dtend ?? null}, deadline = ${
        prepared.deadline ?? null
      },
          lead_time_days = ${prepared.lead_time_days ?? null},
          reminder_offsets_minutes = ${
        tx.json(prepared.reminder_offsets_minutes as never)
      },
          recurrence_rule = ${
        prepared.recurrence_rule
          ? tx.json(prepared.recurrence_rule as never)
          : null
      },
          category = ${
        prepared.category ?? null
      }, timezone = ${prepared.timezone},
          next_due_at = ${nextDueAt}
        WHERE id = ${eventId}
      `;

      if (rebuildSchedule) {
        await replaceOpenEventSchedule({
          sql: tx,
          eventId,
          eventAt,
          reminderOffsetsMinutes: prepared.reminder_offsets_minutes,
        });
      }
      if (!rebuildSchedule && changes.priority) {
        await resetReminderRepeatPolicy(tx, eventId, changes.priority);
      }
    });
  } catch (err: unknown) {
    return eventToolResult({
      operation: "update",
      changed: false,
      eventId,
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  if (!title) {
    return eventToolResult({
      operation: "update",
      changed: false,
      eventId,
      reason: "no_active_event",
    });
  }
  await trace(traceId, "db.update", {
    table: "events",
    id: eventId,
    fields: changedFields,
  });
  return eventToolResult({ operation: "update", changed: true, eventId, title });
}
