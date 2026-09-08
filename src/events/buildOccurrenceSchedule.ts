export interface OccurrenceScheduleItem {
  offsetMinutes: number;
  dueAt: string;
}

export function buildOccurrenceSchedule(
  eventAt: string,
  reminderOffsetsMinutes: number[],
  now = Temporal.Now.instant(),
): OccurrenceScheduleItem[] {
  const eventInstant = Temporal.Instant.from(eventAt);
  const scheduled = reminderOffsetsMinutes.map((offsetMinutes) => ({
    offsetMinutes,
    dueAt: eventInstant.subtract({ minutes: offsetMinutes }),
  }));
  const future = scheduled.filter((item) =>
    Temporal.Instant.compare(item.dueAt, now) > 0
  );
  const past = scheduled.filter((item) =>
    Temporal.Instant.compare(item.dueAt, now) <= 0
  );
  const collapsedPast = past.length > 0
    ? [
      past.reduce((latest, item) =>
        Temporal.Instant.compare(item.dueAt, latest.dueAt) > 0 ? item : latest
      ),
    ]
    : [];
  return [...collapsedPast, ...future].map((item) => ({
    offsetMinutes: item.offsetMinutes,
    dueAt: item.dueAt.toString(),
  }));
}
