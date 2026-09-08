import type { EventData } from "@/events/manageEventsSchema.ts";

export function storedEventToData(row: Record<string, unknown>): EventData {
  const date = (value: unknown) =>
    value instanceof Date ? value.toISOString() : value as string | undefined;
  return {
    title: row.title as string,
    type: row.type as EventData["type"],
    priority: row.priority as EventData["priority"],
    dtstart: date(row.dtstart),
    dtend: date(row.dtend),
    deadline: date(row.deadline),
    lead_time_days: row.lead_time_days as number | undefined,
    reminder_offsets_minutes: row.reminder_offsets_minutes as
      | number[]
      | undefined,
    recurrence_rule: row.recurrence_rule as EventData["recurrence_rule"],
    category: row.category as string | undefined,
    timezone: row.timezone as string | undefined,
  };
}
