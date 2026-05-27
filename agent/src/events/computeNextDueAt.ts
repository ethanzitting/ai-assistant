export function computeNextDueAt(
  eventData: Record<string, unknown>,
): string | null {
  const recurrenceRule = eventData.recurrence_rule as
    | Record<string, unknown>
    | undefined;

  if (!recurrenceRule) {
    return (eventData.dtstart as string) ?? (eventData.deadline as string) ?? null;
  }

  const interval = recurrenceRule.interval as number;
  const unit = recurrenceRule.unit as string;
  const isFromCompletion = recurrenceRule.from_completion as boolean;

  const anchorDate = isFromCompletion ? new Date() : parseAnchorDate(eventData);
  if (!anchorDate) return null;

  return addInterval(anchorDate, interval, unit).toISOString();
}

function parseAnchorDate(eventData: Record<string, unknown>): Date | null {
  const dateString = (eventData.dtstart as string) ??
    (eventData.deadline as string);
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
