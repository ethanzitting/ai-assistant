import { db } from "@/db.ts";
import type { FinanceFilters } from "@/finance/financeFilters.ts";
import { formatMoney } from "@/finance/formatMoney.ts";

const DEFAULT_LIMIT = 15;

export async function spendingByMerchant(
  filters: FinanceFilters,
  limit = DEFAULT_LIMIT,
): Promise<string> {
  const rows = await db`
    SELECT coalesce(t.merchant_name, t.description) AS merchant,
           count(*)::int AS count,
           sum(t.amount) AS total
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.removed_at IS NULL
      AND t.transaction_type = 'expense'
      AND t.posted_date BETWEEN ${filters.range.start} AND ${filters.range.end}
      AND (${filters.categories}::text[] IS NULL OR lower(t.category) = ANY(${filters.categories}))
      AND (${filters.merchants}::text[] IS NULL OR lower(t.merchant_name) = ANY(${filters.merchants}))
      AND (${filters.accounts}::text[] IS NULL OR lower(a.name) = ANY(${filters.accounts}))
    GROUP BY 1 ORDER BY sum(t.amount) DESC LIMIT ${limit}
  ` as unknown as { merchant: string; count: number; total: number }[];

  if (rows.length === 0) return "No spending in that range.";

  const lines = rows.map((row) =>
    `${row.merchant}: ${formatMoney(row.total)} (${row.count} txns)`
  );

  return `${filters.range.start} to ${filters.range.end}\n${lines.join("\n")}`;
}
