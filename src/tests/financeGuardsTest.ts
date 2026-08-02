import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveDateRange } from "@/finance/resolveDateRange.ts";
import { escapeLikePattern } from "@/finance/escapeLikePattern.ts";
import { requirePrivateChat } from "@/finance/requirePrivateChat.ts";
import { unknownValues } from "@/finance/unknownValues.ts";

// Reversed bounds make BETWEEN match nothing, which answered "$0.00 across 0 transactions" — a
// confident zero rather than an error.
Deno.test("resolveDateRange orders a reversed pair instead of returning an empty window", () => {
  assertEquals(
    resolveDateRange("2026-07-31", "2026-07-01"),
    { start: "2026-07-01", end: "2026-07-31" },
  );
  assertEquals(
    resolveDateRange("2026-07-01", "2026-07-31"),
    { start: "2026-07-01", end: "2026-07-31" },
  );
});

// An unescaped % matched all 2,497 stored transactions.
Deno.test("escapeLikePattern neutralises wildcards", () => {
  assertEquals(escapeLikePattern("100% Whey"), "100\\% Whey");
  assertEquals(escapeLikePattern("A_B"), "A\\_B");
  assertEquals(escapeLikePattern("Trader Joe's"), "Trader Joe's");
});

// Backslash must be escaped first, or it would double-escape what follows.
Deno.test("escapeLikePattern escapes the escape character first", () => {
  assertEquals(escapeLikePattern("a\\%b"), "a\\\\\\%b");
});

Deno.test("requirePrivateChat allows only the owner's chat", () => {
  const previous = Deno.env.get("TELEGRAM_OWNER_ID");
  Deno.env.set("TELEGRAM_OWNER_ID", "402864915");

  assertEquals(requirePrivateChat(402864915), null);
  assertEquals(requirePrivateChat(-5051670848)?.isError, true);
  assertEquals(requirePrivateChat(null)?.isError, true);
  assertEquals(requirePrivateChat(undefined)?.isError, true);

  if (previous === undefined) Deno.env.delete("TELEGRAM_OWNER_ID");
  else Deno.env.set("TELEGRAM_OWNER_ID", previous);
});

// Fail closed: with no owner configured there is no chat that can be proven safe.
Deno.test("requirePrivateChat refuses when no owner is configured", () => {
  const previous = Deno.env.get("TELEGRAM_OWNER_ID");
  Deno.env.delete("TELEGRAM_OWNER_ID");

  assertEquals(requirePrivateChat(402864915)?.isError, true);

  if (previous !== undefined) Deno.env.set("TELEGRAM_OWNER_ID", previous);
});

// The bug this guards: "food & drink" is not a category, and returning zero rows for it is
// indistinguishable from having spent nothing.
Deno.test("unknownValues finds filter values absent from the data", () => {
  const known = ["food and drink", "general merchandise"];
  assertEquals(unknownValues(["food & drink"], known), ["food & drink"]);
  assertEquals(unknownValues(["food and drink"], known), []);
  assertEquals(unknownValues(["food and drink", "nope"], known), ["nope"]);
  assertEquals(unknownValues([], known), []);
});
