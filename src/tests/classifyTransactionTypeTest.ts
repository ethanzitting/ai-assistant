import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyTransactionType } from "@/finance/classifyTransactionType.ts";

Deno.test("classifyTransactionType treats a credit card payment as a transfer", () => {
  assertEquals(
    classifyTransactionType({
      plaidCategoryPrimary: "LOAN_PAYMENTS",
      plaidCategoryDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
      amount: 412.55,
    }),
    "transfer",
  );
});

Deno.test("classifyTransactionType keeps other loan payments as expenses", () => {
  assertEquals(
    classifyTransactionType({
      plaidCategoryPrimary: "LOAN_PAYMENTS",
      plaidCategoryDetailed: "LOAN_PAYMENTS_CAR_PAYMENT",
      amount: 380,
    }),
    "expense",
  );
});

Deno.test("classifyTransactionType reads both directions of a transfer", () => {
  const args = { plaidCategoryDetailed: null, amount: 100 };
  assertEquals(classifyTransactionType({ ...args, plaidCategoryPrimary: "TRANSFER_OUT" }), "transfer");
  assertEquals(classifyTransactionType({ ...args, plaidCategoryPrimary: "TRANSFER_IN" }), "transfer");
});

// The credit-card side of a card payment. As an expense its negative amount subtracts from
// spending, which understates every total instead of merely inflating one.
Deno.test("classifyTransactionType treats a loan disbursement as a transfer", () => {
  assertEquals(
    classifyTransactionType({
      plaidCategoryPrimary: "LOAN_DISBURSEMENTS",
      plaidCategoryDetailed: "LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT",
      amount: -1757.73,
    }),
    "transfer",
  );
});

// A refund is genuinely a negative expense and must stay one, so the fix above cannot simply be
// "no expense may be negative".
Deno.test("classifyTransactionType keeps a refund as a negative expense", () => {
  assertEquals(
    classifyTransactionType({
      plaidCategoryPrimary: "GENERAL_MERCHANDISE",
      plaidCategoryDetailed: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES",
      amount: -51.22,
    }),
    "expense",
  );
});

Deno.test("classifyTransactionType recognises income", () => {
  assertEquals(
    classifyTransactionType({
      plaidCategoryPrimary: "INCOME",
      plaidCategoryDetailed: "INCOME_WAGES",
      amount: -2400,
    }),
    "income",
  );
});

// Plaid signs a positive amount as money leaving the account, so an uncategorised negative amount
// is money arriving. Getting this backwards would file every paycheck as spending.
Deno.test("classifyTransactionType falls back to the sign when Plaid gives no category", () => {
  const args = { plaidCategoryPrimary: null, plaidCategoryDetailed: null };
  assertEquals(classifyTransactionType({ ...args, amount: -1200 }), "income");
  assertEquals(classifyTransactionType({ ...args, amount: 34.19 }), "expense");
});

Deno.test("classifyTransactionType defaults a categorised transaction to an expense", () => {
  assertEquals(
    classifyTransactionType({
      plaidCategoryPrimary: "FOOD_AND_DRINK",
      plaidCategoryDetailed: "FOOD_AND_DRINK_GROCERIES",
      amount: 87.43,
    }),
    "expense",
  );
});
