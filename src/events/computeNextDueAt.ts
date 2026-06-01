import type { RecurrenceRule } from "@/events/manageEventsSchema.ts";

interface EventDates {
  dtstart?: string;
  deadline?: string;
  recurrence_rule?: RecurrenceRule;
}

export function computeNextDueAt(event: EventDates): string | null {
  if (!event.recurrence_rule) {
    return event.dtstart ?? event.deadline ?? null;
  }

  const { interval, unit, from_completion } = event.recurrence_rule;
  const anchorDate = from_completion
    ? new Date()
    : parseAnchorDate(event);

  if (!anchorDate) return null;

  return addInterval(anchorDate, interval, unit).toISOString();
}

function parseAnchorDate(event: EventDates): Date | null {
  const dateString = event.dtstart ?? event.deadline;
  if (!dateString) return null;
  return new Date(dateString);
}

function addInterval(baseDate: Date, interval: number, unit: string): Date {
  const resultDate = new Date(baseDate);

  switch (unit) {
    case "days":
      resultDate.setDate(resultDate.getDate() + interval);
      break;
    case "weeks":
      resultDate.setDate(resultDate.getDate() + interval * 7);
      break;
    case "months":
      resultDate.setMonth(resultDate.getMonth() + interval);
      break;
  }

  return resultDate;
}
