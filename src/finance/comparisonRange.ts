import type { DateRange } from "@/finance/resolveDateRange.ts";

export type ComparisonKind = "previous_period" | "same_period_last_year";

// Both ranges are treated as plain dates, never instants, so no timezone can shift a boundary.
export function comparisonRange(range: DateRange, kind: ComparisonKind): DateRange {
  if (kind === "same_period_last_year") {
    return { start: addYears(range.start, -1), end: addYears(range.end, -1) };
  }

  // A whole calendar month compares against the whole previous calendar month. Counting back the
  // same number of days would answer with 2026-05-31 to 2026-06-30 for July — correct arithmetic,
  // but not what anyone means by "last month", and the odd boundary makes the figure look wrong.
  if (isWholeCalendarMonth(range)) return previousCalendarMonth(range.start);

  const lengthInDays = daysBetween(range.start, range.end);
  const end = addDays(range.start, -1);
  return { start: addDays(end, -lengthInDays), end };
}

function isWholeCalendarMonth(range: DateRange): boolean {
  if (!range.start.endsWith("-01")) return false;
  return range.end === lastDayOfMonth(range.start);
}

function previousCalendarMonth(start: string): DateRange {
  const [year, month] = start.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
  return { start: previous, end: lastDayOfMonth(previous) };
}

// Day 0 of the next month is the last day of this one.
function lastDayOfMonth(iso: string): string {
  const [year, month] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

function addDays(iso: string, days: number): string {
  const shifted = new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

// Calendar arithmetic, not 365 days, so a range that spans a leap day still lands on the same
// month and day a year earlier.
function addYears(iso: string, years: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const shifted = new Date(Date.UTC(year + years, month - 1, day));
  return shifted.toISOString().slice(0, 10);
}
