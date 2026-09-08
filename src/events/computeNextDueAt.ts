import type { RecurrenceRule } from "@/events/manageEventsSchema.ts";

const weekdayNumber = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
} as const;

export function computeNextDueAt(
  recurrenceRule: RecurrenceRule,
  anchor: string | Date,
  timezone: string,
): string {
  const instant = anchor instanceof Date
    ? Temporal.Instant.fromEpochMilliseconds(anchor.getTime())
    : Temporal.Instant.from(anchor);
  const zonedAnchor = instant.toZonedDateTimeISO(timezone);

  if (recurrenceRule.monthly_weekday) {
    return nextMonthlyWeekday(zonedAnchor, recurrenceRule).toInstant()
      .toString();
  }
  if (recurrenceRule.business_day) {
    return nextBusinessDay(zonedAnchor, recurrenceRule).toInstant().toString();
  }

  return zonedAnchor.add({ [recurrenceRule.unit]: recurrenceRule.interval })
    .toInstant()
    .toString();
}

function nextMonthlyWeekday(
  anchor: Temporal.ZonedDateTime,
  rule: RecurrenceRule,
): Temporal.ZonedDateTime {
  const pattern = rule.monthly_weekday!;
  const month = anchor.add({ months: rule.interval }).with({ day: 1 });
  const targetDay = weekdayNumber[pattern.weekday];

  if (pattern.ordinal === -1) {
    let date = month.add({ months: 1 }).subtract({ days: 1 });
    while (date.dayOfWeek !== targetDay) date = date.subtract({ days: 1 });
    return date;
  }

  let date = month.add({ days: (targetDay - month.dayOfWeek + 7) % 7 });
  date = date.add({ days: (pattern.ordinal - 1) * 7 });
  return date;
}

function nextBusinessDay(
  anchor: Temporal.ZonedDateTime,
  rule: RecurrenceRule,
): Temporal.ZonedDateTime {
  const month = anchor.add({ months: rule.interval }).with({ day: 1 });
  let date = rule.business_day === "first"
    ? month
    : month.add({ months: 1 }).subtract({ days: 1 });
  const direction = rule.business_day === "first" ? 1 : -1;
  while (date.dayOfWeek > 5) date = date.add({ days: direction });
  return date;
}
