import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveCategory, type CategoryRule } from "@/finance/resolveCategory.ts";

const groceryRule: CategoryRule = {
  match_type: "merchant",
  match_value: "Ozark Natural Foods",
  category: "Groceries",
  policy: "auto",
};

const askWalmart: CategoryRule = {
  match_type: "merchant",
  match_value: "Walmart",
  category: null,
  policy: "ask",
};

Deno.test("resolveCategory applies an auto rule", () => {
  assertEquals(
    resolveCategory({
      merchantName: "Ozark Natural Foods",
      description: "OZARK NATURAL FOODS",
      rules: [groceryRule],
    }),
    { category: "Groceries", source: "rule", needsCategory: false },
  );
});

Deno.test("resolveCategory matches a merchant rule regardless of case", () => {
  assertEquals(
    resolveCategory({
      merchantName: "OZARK NATURAL FOODS",
      description: "anything",
      rules: [groceryRule],
    }).category,
    "Groceries",
  );
});

Deno.test("resolveCategory matches a substring of the raw bank description", () => {
  assertEquals(
    resolveCategory({
      merchantName: null,
      description: "SWEPCO BILLMATRIX 8829",
      rules: [{
        match_type: "description_contains",
        match_value: "swepco",
        category: "Utility: Electricity",
        policy: "auto",
      }],
    }),
    { category: "Utility: Electricity", source: "rule", needsCategory: false },
  );
});

// The whole point of an 'ask' vendor: it has a rule, but the rule's answer is "put it in the
// queue", not a category.
Deno.test("resolveCategory queues an ask-policy vendor rather than categorizing it", () => {
  assertEquals(
    resolveCategory({
      merchantName: "Walmart",
      description: "WALMART #123",
      rules: [askWalmart],
    }),
    { category: "Unsorted", source: null, needsCategory: true },
  );
});

// Plaid's category is deliberately not consulted. Inheriting it is what produced confident wrong
// answers — Walmart is GENERAL_MERCHANDISE on all 234 of its transactions.
Deno.test("resolveCategory leaves an unknown merchant Unsorted and queued", () => {
  assertEquals(
    resolveCategory({
      merchantName: "Some New Cafe",
      description: "SOME NEW CAFE 42",
      rules: [groceryRule, askWalmart],
    }),
    { category: "Unsorted", source: null, needsCategory: true },
  );
});
