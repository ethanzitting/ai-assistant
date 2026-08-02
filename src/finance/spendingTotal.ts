import { db } from "@/db.ts";
import type { FinanceFilters } from "@/finance/financeFilters.ts";

export interface SpendingTotal {
  total: number;
  count: number;
}

// transaction_type = 'expense' is the load-bearing clause. Transfers between the user's own
// accounts and credit card payments are money moving, not money spent, and including them inflates
// every total by roughly the size of the card balance.
export async function spendingTotal(filters: FinanceFilters): Promise<SpendingTotal> {
  const [row] = await db`
    SELECT count(*)::int AS count, coalesce(sum(t.amount), 0) AS total
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.removed_at IS NULL
      AND t.transaction_type = 'expense'
      AND t.posted_date BETWEEN ${filters.range.start} AND ${filters.range.end}
      AND (${filters.categories}::text[] IS NULL OR lower(t.category) = ANY(${filters.categories}))
      AND (${filters.merchants}::text[] IS NULL OR lower(t.merchant_name) = ANY(${filters.merchants}))
      AND (${filters.accounts}::text[] IS NULL OR lower(a.name) = ANY(${filters.accounts}))
  ` as unknown as [SpendingTotal];

  return row;
}
