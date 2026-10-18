import { assertEquals } from "jsr:@std/assert";
import { formatTransactionSearchHeader } from "@/finance/formatTransactionSearchHeader.ts";

Deno.test("transaction search header identifies a truncated result", () => {
  assertEquals(
    formatTransactionSearchHeader(90, 30),
    "TOTAL_MATCHES: 90\nROWS_RETURNED: 30\nTRUNCATED: true\nMost recent rows:",
  );
});

Deno.test("transaction search header identifies a complete result", () => {
  assertEquals(
    formatTransactionSearchHeader(8, 8),
    "TOTAL_MATCHES: 8\nROWS_RETURNED: 8\nTRUNCATED: false\nRows:",
  );
});
