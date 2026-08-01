import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { toTransactionRow } from "@/finance/toTransactionRow.ts";
import type { PlaidTransaction } from "@/plaid/fetchTransactionPage.ts";

function plaidTransaction(overrides: Partial<PlaidTransaction> = {}): PlaidTransaction {
  return {
    transaction_id: "txn_1",
    account_id: "acct_plaid_1",
    amount: 87.43,
    iso_currency_code: "USD",
    date: "2026-07-14",
    authorized_date: "2026-07-13",
    name: "TRADER JOES #123",
    merchant_name: "Trader Joe's",
    pending: false,
    pending_transaction_id: null,
    payment_channel: "in store",
    personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES" },
    ...overrides,
  };
}

Deno.test("toTransactionRow maps Plaid's field names onto the table's", () => {
  const row = toTransactionRow({
    transaction: plaidTransaction(),
    accountId: "00000000-0000-0000-0000-000000000001",
    rules: [],
  });

  assertEquals(row.plaid_transaction_id, "txn_1");
  assertEquals(row.posted_date, "2026-07-14");
  assertEquals(row.authorized_date, "2026-07-13");
  assertEquals(row.description, "TRADER JOES #123");
  assertEquals(row.merchant_name, "Trader Joe's");
  assertEquals(row.plaid_category_primary, "FOOD_AND_DRINK");
  assertEquals(row.plaid_category_detailed, "FOOD_AND_DRINK_GROCERIES");
  assertEquals(row.category, "food and drink");
  assertEquals(row.category_source, "plaid");
  assertEquals(row.transaction_type, "expense");
  assertEquals(row.source, "plaid");
});

// Plaid's sign is stored unchanged. Flipping it here would invert every spending total.
Deno.test("toTransactionRow keeps Plaid's amount sign", () => {
  const spend = toTransactionRow({
    transaction: plaidTransaction({ amount: 87.43 }),
    accountId: "acct",
    rules: [],
  });
  const paycheck = toTransactionRow({
    transaction: plaidTransaction({
      amount: -2400,
      personal_finance_category: { primary: "INCOME", detailed: "INCOME_WAGES" },
    }),
    accountId: "acct",
    rules: [],
  });

  assertEquals(spend.amount, 87.43);
  assertEquals(spend.transaction_type, "expense");
  assertEquals(paycheck.amount, -2400);
  assertEquals(paycheck.transaction_type, "income");
});

// applyTransactionPage reads this back out to retire the pending row the posted one settles, so the
// link has to survive the mapping.
Deno.test("toTransactionRow carries the pending transaction link into properties", () => {
  const linked = toTransactionRow({
    transaction: plaidTransaction({ pending_transaction_id: "txn_pending_1" }),
    accountId: "acct",
    rules: [],
  });
  const unlinked = toTransactionRow({
    transaction: plaidTransaction(),
    accountId: "acct",
    rules: [],
  });

  assertEquals(linked.properties, { pending_transaction_id: "txn_pending_1" });
  assertEquals(unlinked.properties, {});
});

Deno.test("toTransactionRow applies a category rule ahead of Plaid's category", () => {
  const row = toTransactionRow({
    transaction: plaidTransaction(),
    accountId: "acct",
    rules: [{ match_type: "merchant", match_value: "trader joe's", category: "groceries" }],
  });

  assertEquals(row.category, "groceries");
  assertEquals(row.category_source, "rule");
});
