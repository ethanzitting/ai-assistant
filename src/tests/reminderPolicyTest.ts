import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { prepareEventData } from "@/events/prepareEventData.ts";
import { buildOccurrenceSchedule } from "@/events/buildOccurrenceSchedule.ts";

Deno.test("reminders require an explicit or context-derived date", () => {
  assertThrows(
    () => prepareEventData({ title: "Call Mom", type: "fixed" }),
    Error,
    "require a date",
  );
});

Deno.test("deadline alert offsets are independent and ordered chronologically", () => {
  const event = prepareEventData({
    title: "File taxes",
    type: "deadline",
    deadline: "2027-04-15T17:00:00-05:00",
    reminder_offsets_minutes: [0, 1440, 10_080, 1440],
  });
  assertEquals(event.reminder_offsets_minutes, [10_080, 1440, 0]);
});

Deno.test("event type determines completion-relative recurrence", () => {
  const event = prepareEventData({
    title: "Replace filter",
    type: "interval_recurring",
    dtstart: "2026-10-01",
    recurrence_rule: { interval: 90, unit: "days", from_completion: false },
  });
  assertEquals(event.recurrence_rule?.from_completion, true);
});

Deno.test("advance offsets are rejected outside one-time deadlines", () => {
  assertThrows(
    () =>
      prepareEventData({
        title: "Trash day",
        type: "fixed_recurring",
        dtstart: "2026-09-10T07:00:00-05:00",
        reminder_offsets_minutes: [60],
        recurrence_rule: { interval: 1, unit: "weeks" },
      }),
    Error,
    "one-time deadlines",
  );
});

Deno.test("missed deadline alerts collapse while future alerts remain", () => {
  const schedule = buildOccurrenceSchedule(
    "2026-09-10T13:00:00Z",
    [4320, 1440, 0],
    Temporal.Instant.from("2026-09-09T14:00:00Z"),
  );
  assertEquals(schedule, [
    { offsetMinutes: 1440, dueAt: "2026-09-09T13:00:00Z" },
    { offsetMinutes: 0, dueAt: "2026-09-10T13:00:00Z" },
  ]);
});
