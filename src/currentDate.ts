// The "now" anchor shared by the live system prompt and offline maintenance.
//
// Day resolution, not time-of-day, on purpose: the system prompt that embeds this is
// prompt-cached, so a finer-grained value would bust the cache on every turn. Day
// resolution still fixes year/month/day stamping and only invalidates the cache once a day.
// Timezone defaults to the user's home zone; override with JARVIS_TIMEZONE (optional env,
// so it never touches the op-run secret flow).
const DEFAULT_TIMEZONE = "America/Chicago";

export function currentDateLabel(): string {
  const timeZone = Deno.env.get("JARVIS_TIMEZONE") ?? DEFAULT_TIMEZONE;
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone,
  });
}
