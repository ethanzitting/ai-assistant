import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveCategory, type CategoryRule } from "@/finance/resolveCategory.ts";

const groceryRule: CategoryRule = {
  match_type: "merchant",
  match_value: "Trader Joe's",
  category: "groceries",
};

Deno.test("resolveCategory prefers a matching rule over Plaid's category", () => {
  assertEquals(
    resolveCategory({
      merchantName: "Trader Joe's",
      description: "TRADER JOES #123",
      plaidCategoryPrimary: "FOOD_AND_DRINK",
      rules: [groceryRule],
    }),
    { category: "groceries", source: "rule" },
  );
});

Deno.test("resolveCategory matches a merchant rule regardless of case", () => {
  assertEquals(
    resolveCategory({
      merchantName: "TRADER JOE'S",
      description: "anything",
      plaidCategoryPrimary: null,
      rules: [groceryRule],
    }).category,
    "groceries",
  );
});

Deno.test("resolveCategory matches a substring of the raw bank description", () => {
  assertEquals(
    resolveCategory({
      merchantName: null,
      description: "SQ *BLUE PLATE CAFE SLC",
      plaidCategoryPrimary: "FOOD_AND_DRINK",
      rules: [{ match_type: "description_contains", match_value: "blue plate", category: "dining" }],
    }),
    { category: "dining", source: "rule" },
  );
});

Deno.test("resolveCategory humanizes Plaid's taxonomy when no rule matches", () => {
  assertEquals(
    resolveCategory({
      merchantName: "Delta",
      description: "DELTA AIR LINES",
      plaidCategoryPrimary: "TRAVEL",
      rules: [groceryRule],
    }),
    { category: "travel", source: "plaid" },
  );

  assertEquals(
    resolveCategory({
      merchantName: null,
      description: "x",
      plaidCategoryPrimary: "FOOD_AND_DRINK",
      rules: [],
    }).category,
    "food and drink",
  );
});

Deno.test("resolveCategory returns nothing when it has nothing to go on", () => {
  assertEquals(
    resolveCategory({
      merchantName: null,
      description: "UNKNOWN 8812",
      plaidCategoryPrimary: null,
      rules: [],
    }),
    { category: null, source: null },
  );
});
