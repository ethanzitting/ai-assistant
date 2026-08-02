// The "now" anchor shared by the live system prompt and offline maintenance.
//
// Day resolution, not time-of-day, on purpose: the system prompt that embeds this is
// prompt-cached, so a finer-grained value would bust the cache on every turn. Day
// resolution still fixes year/month/day stamping and only invalidates the cache once a day.
// Timezone comes from userTimezone().
import { userTimezone } from "@/userTimezone.ts";

export function currentDateLabel(): string {
  const timeZone = userTimezone();
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone,
  });
}
