export function normalizeEventDate(value: string, timezone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return Temporal.PlainDate.from(value)
      .toZonedDateTime({ timeZone: timezone, plainTime: "08:00" })
      .toInstant()
      .toString();
  }

  try {
    return Temporal.Instant.from(value).toString();
  } catch {
    return Temporal.PlainDateTime.from(value)
      .toZonedDateTime(timezone)
      .toInstant()
      .toString();
  }
}
