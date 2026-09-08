import { userTimezone } from "@/userTimezone.ts";

export function currentTimeContext(): string {
  const timezone = userTimezone();
  const now = new Date();
  const local = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(now);
  return `[CURRENT TIME]\n${local} (${timezone}; ${now.toISOString()})`;
}
