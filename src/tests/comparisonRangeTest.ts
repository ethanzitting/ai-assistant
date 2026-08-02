import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { comparisonRange } from "@/finance/comparisonRange.ts";

// Counting back 31 days from July would give 2026-05-31 to 2026-06-30 — right arithmetic, wrong
// answer to "how does this month compare with last month".
Deno.test("comparisonRange maps a whole month onto the previous whole month", () => {
  assertEquals(
    comparisonRange({ start: "2026-07-01", end: "2026-07-31" }, "previous_period"),
    { start: "2026-06-01", end: "2026-06-30" },
  );
});

Deno.test("comparisonRange handles month lengths and year boundaries", () => {
  assertEquals(
    comparisonRange({ start: "2026-03-01", end: "2026-03-31" }, "previous_period"),
    { start: "2026-02-01", end: "2026-02-28" },
  );
  assertEquals(
    comparisonRange({ start: "2026-01-01", end: "2026-01-31" }, "previous_period"),
    { start: "2025-12-01", end: "2025-12-31" },
  );
});

Deno.test("comparisonRange counts back equal days for a partial range", () => {
  assertEquals(
    comparisonRange({ start: "2026-07-10", end: "2026-07-16" }, "previous_period"),
    { start: "2026-07-03", end: "2026-07-09" },
  );
});

Deno.test("comparisonRange shifts a year back by calendar, not by 365 days", () => {
  assertEquals(
    comparisonRange({ start: "2026-07-01", end: "2026-07-31" }, "same_period_last_year"),
    { start: "2025-07-01", end: "2025-07-31" },
  );
});
