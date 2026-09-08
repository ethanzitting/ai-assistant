import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeNextDueAt } from "@/events/computeNextDueAt.ts";
import { normalizeEventDate } from "@/events/normalizeEventDate.ts";

const timezone = "America/Chicago";

Deno.test("date-only reminders normalize to 8 AM in the home timezone", () => {
  assertEquals(
    normalizeEventDate("2026-09-08", timezone),
    "2026-09-08T13:00:00Z",
  );
});

Deno.test("daily recurrence preserves wall-clock time across DST", () => {
  const result = computeNextDueAt(
    { interval: 1, unit: "days", from_completion: false },
    "2026-03-07T14:00:00Z",
    timezone,
  );
  assertEquals(result, "2026-03-08T13:00:00Z");
});

Deno.test("weekly recurrence advances from the scheduled occurrence", () => {
  const result = computeNextDueAt(
    { interval: 2, unit: "weeks", from_completion: false },
    "2026-06-01T14:00:00Z",
    timezone,
  );
  assertEquals(result, "2026-06-15T14:00:00Z");
});

Deno.test("monthly recurrence constrains a missing day to month end", () => {
  const result = computeNextDueAt(
    { interval: 1, unit: "months", from_completion: false },
    "2026-01-31T15:00:00Z",
    timezone,
  );
  assertEquals(result, "2026-02-28T15:00:00Z");
});

Deno.test("nth-weekday recurrence supports the second Tuesday", () => {
  const result = computeNextDueAt(
    {
      interval: 1,
      unit: "months",
      from_completion: false,
      monthly_weekday: { ordinal: 2, weekday: "tuesday" },
    },
    "2026-01-13T15:00:00Z",
    timezone,
  );
  assertEquals(result, "2026-02-10T15:00:00Z");
});

Deno.test("business-day recurrence supports the last weekday of the month", () => {
  const result = computeNextDueAt(
    {
      interval: 1,
      unit: "months",
      from_completion: false,
      business_day: "last",
    },
    "2026-01-30T15:00:00Z",
    timezone,
  );
  assertEquals(result, "2026-02-27T15:00:00Z");
});
