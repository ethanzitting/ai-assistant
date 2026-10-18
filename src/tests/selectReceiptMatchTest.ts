import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type ReceiptMatchCandidate,
  selectReceiptMatch,
} from "@/finance/selectReceiptMatch.ts";

function candidate(
  transactionId: string,
  dateDistance: number | null,
): ReceiptMatchCandidate {
  return {
    transactionId,
    merchantName: "Walmart",
    postedDate: new Date("2026-05-10T00:00:00Z"),
    dateDistance,
  };
}

Deno.test("selectReceiptMatch accepts one candidate", () => {
  assertEquals(selectReceiptMatch([candidate("one", 1)])?.transactionId, "one");
});

Deno.test("selectReceiptMatch accepts a uniquely closest candidate", () => {
  assertEquals(
    selectReceiptMatch([candidate("near", 1), candidate("far", 3)])
      ?.transactionId,
    "near",
  );
});

Deno.test("selectReceiptMatch rejects equal date distance", () => {
  assertEquals(
    selectReceiptMatch([candidate("one", 1), candidate("two", 1)]),
    null,
  );
});

Deno.test("selectReceiptMatch rejects ambiguity without a receipt date", () => {
  assertEquals(
    selectReceiptMatch([candidate("one", null), candidate("two", null)]),
    null,
  );
});
