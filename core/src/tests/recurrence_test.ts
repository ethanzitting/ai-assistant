import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeNextDueAt } from "@/tools/event-recurrence.ts";

Deno.test("computeNextDueAt returns dtstart for non-recurring event", () => {
  const result = computeNextDueAt({
    dtstart: "2026-06-01T09:00:00Z",
  });
  assertEquals(result, "2026-06-01T09:00:00Z");
});

Deno.test("computeNextDueAt returns deadline when no dtstart", () => {
  const result = computeNextDueAt({
    deadline: "2026-06-15T17:00:00Z",
  });
  assertEquals(result, "2026-06-15T17:00:00Z");
});

Deno.test("computeNextDueAt returns null with no dates", () => {
  const result = computeNextDueAt({});
  assertEquals(result, null);
});

Deno.test("computeNextDueAt adds days for daily recurrence", () => {
  const result = computeNextDueAt({
    dtstart: "2026-06-01T09:00:00Z",
    recurrence_rule: { interval: 7, unit: "days", from_completion: false },
  });

  const expected = new Date("2026-06-08T09:00:00Z");
  assertEquals(new Date(result!).toISOString(), expected.toISOString());
});

Deno.test("computeNextDueAt adds weeks for weekly recurrence", () => {
  const result = computeNextDueAt({
    dtstart: "2026-06-01T09:00:00Z",
    recurrence_rule: { interval: 2, unit: "weeks", from_completion: false },
  });

  const expected = new Date("2026-06-15T09:00:00Z");
  assertEquals(new Date(result!).toISOString(), expected.toISOString());
});

Deno.test("computeNextDueAt adds months for monthly recurrence", () => {
  const result = computeNextDueAt({
    dtstart: "2026-01-15T09:00:00Z",
    recurrence_rule: { interval: 1, unit: "months", from_completion: false },
  });

  const expected = new Date("2026-02-15T09:00:00Z");
  assertEquals(new Date(result!).toISOString(), expected.toISOString());
});

Deno.test("computeNextDueAt from_completion uses now as anchor", () => {
  const beforeCall = new Date();
  const result = computeNextDueAt({
    recurrence_rule: { interval: 30, unit: "days", from_completion: true },
  });

  assertNotEquals(result, null);
  const resultDate = new Date(result!);
  const expectedMin = new Date(beforeCall.getTime() + 30 * 24 * 60 * 60 * 1000 - 1000);
  assertEquals(resultDate >= expectedMin, true);
});
