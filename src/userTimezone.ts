// The user's home zone. Month and day boundaries in spending queries have to match the calendar
// the user actually lives in — the container runs UTC, so "this month" would otherwise roll over
// hours early. Override with JARVIS_TIMEZONE (optional env, so it never touches the op-run
// secret flow).
const DEFAULT_TIMEZONE = "America/Chicago";

export function userTimezone(): string {
  return Deno.env.get("JARVIS_TIMEZONE") ?? DEFAULT_TIMEZONE;
}
