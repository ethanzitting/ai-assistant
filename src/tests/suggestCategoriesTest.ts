import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { suggestCategories } from "@/finance/suggestCategories.ts";

const overall = [
  { name: "Groceries", count: 90 },
  { name: "Restaurants", count: 40 },
  { name: "Household Items", count: 20 },
  { name: "Car Fuel", count: 10 },
  { name: "Entertainment", count: 5 },
  { name: "Gifts", count: 2 },
  { name: "Parking", count: 1 },
];

// What this merchant got before leads, because a repeat visit is the common case and getting it
// into the first row is what makes this one tap rather than a search.
Deno.test("suggestCategories puts merchant history first", () => {
  assertEquals(
    suggestCategories({
      forThisMerchant: [{ name: "Pet Food", count: 4 }, { name: "Vet Bills", count: 1 }],
      overall,
      slots: 6,
    }),
    ["Pet Food", "Vet Bills", "Groceries", "Restaurants", "Household Items", "Car Fuel"],
  );
});

Deno.test("suggestCategories falls back to overall use for an unknown merchant", () => {
  assertEquals(
    suggestCategories({ forThisMerchant: [], overall, slots: 6 }),
    ["Groceries", "Restaurants", "Household Items", "Car Fuel", "Entertainment", "Gifts"],
  );
});

// A category the merchant already uses must not also appear in the filler half.
Deno.test("suggestCategories never repeats a category", () => {
  const result = suggestCategories({
    forThisMerchant: [{ name: "Groceries", count: 8 }],
    overall,
    slots: 6,
  });

  assertEquals(result[0], "Groceries");
  assertEquals(new Set(result).size, result.length);
  assertEquals(result.length, 6);
});

Deno.test("suggestCategories returns what it has when there is little history", () => {
  assertEquals(
    suggestCategories({
      forThisMerchant: [],
      overall: [{ name: "Groceries", count: 1 }],
      slots: 6,
    }),
    ["Groceries"],
  );
});
