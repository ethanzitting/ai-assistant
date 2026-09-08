import type { EventData, RecurrenceRule } from "@/events/manageEventsSchema.ts";
import { normalizeEventDate } from "@/events/normalizeEventDate.ts";
import { userTimezone } from "@/userTimezone.ts";

export interface PreparedEventData extends EventData {
  timezone: string;
  dtstart?: string;
  dtend?: string;
  deadline?: string;
  reminder_offsets_minutes: number[];
  recurrence_rule?: RecurrenceRule;
}

export function prepareEventData(event: EventData): PreparedEventData {
  const timezone = event.timezone ?? userTimezone();
  Temporal.Now.zonedDateTimeISO(timezone);

  const prepared = {
    ...event,
    timezone,
    dtstart: event.dtstart
      ? normalizeEventDate(event.dtstart, timezone)
      : undefined,
    dtend: event.dtend ? normalizeEventDate(event.dtend, timezone) : undefined,
    deadline: event.deadline
      ? normalizeEventDate(event.deadline, timezone)
      : undefined,
    reminder_offsets_minutes: reminderOffsets(event),
    recurrence_rule: event.recurrence_rule
      ? {
        ...event.recurrence_rule,
        from_completion: event.type === "interval_recurring",
      }
      : undefined,
  };

  validateSchedule(prepared);
  return prepared;
}

function reminderOffsets(event: EventData): number[] {
  const offsets = event.reminder_offsets_minutes ??
    (event.lead_time_days === undefined ? [0] : [event.lead_time_days * 1440]);
  return [...new Set(offsets)].sort((left, right) => right - left);
}

function validateSchedule(event: PreparedEventData): void {
  const eventAt = event.type === "deadline" ? event.deadline : event.dtstart;
  if (!eventAt) throw new Error(`${event.type} reminders require a date.`);

  const recurring = event.type === "fixed_recurring" ||
    event.type === "interval_recurring";
  if (recurring !== Boolean(event.recurrence_rule)) {
    throw new Error(
      recurring
        ? `${event.type} reminders require a recurrence rule.`
        : `${event.type} reminders cannot include a recurrence rule.`,
    );
  }
  if (
    event.type !== "deadline" &&
    event.reminder_offsets_minutes.some((offset) => offset !== 0)
  ) {
    throw new Error(
      "Advance reminder offsets are currently supported only for one-time deadlines.",
    );
  }
  if (
    event.recurrence_rule?.monthly_weekday && event.recurrence_rule.business_day
  ) {
    throw new Error(
      "Choose either an nth weekday or a business-day schedule, not both.",
    );
  }
  if (
    (event.recurrence_rule?.monthly_weekday ||
      event.recurrence_rule?.business_day) &&
    (event.recurrence_rule.unit !== "months" ||
      event.type !== "fixed_recurring")
  ) {
    throw new Error(
      "Nth-weekday and business-day schedules must use fixed monthly recurrence.",
    );
  }
}
