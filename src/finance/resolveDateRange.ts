import { userTimezone } from "@/userTimezone.ts";

export interface DateRange {
  start: string;
  end: string;
}

// en-CA formats as YYYY-MM-DD, which is what the DATE column wants and what avoids re-parsing a
// localised string. The zone matters: the container runs UTC, so asking it for "today" would roll
// the month over hours before the user's calendar does.
export function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: userTimezone() });
}

// Defaults to the current calendar month through today. Callers always report the range they used,
// so a default is never silently assumed on the user's behalf.
export function resolveDateRange(startDate?: string, endDate?: string): DateRange {
  const today = todayIso();
  const start = startDate ?? `${today.slice(0, 7)}-01`;
  const end = endDate ?? today;

  // BETWEEN with reversed bounds matches nothing, so "July 31 back to July 1" would answer
  // "$0.00 across 0 transactions" — a confident zero that reads like a real result. Ordering the
  // pair is safe because every caller prints the range it used, so the correction is visible.
  return start <= end ? { start, end } : { start: end, end: start };
}
