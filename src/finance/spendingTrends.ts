import { db } from "@/db.ts";
import type { FinanceFilters } from "@/finance/financeFilters.ts";
import { formatMoney } from "@/finance/formatMoney.ts";

export async function spendingTrends(filters: FinanceFilters): Promise<string> {
  const rows = await db`
    SELECT to_char(t.posted_date, 'YYYY-MM') AS month,
           count(DISTINCT t.id)::int AS count,
           sum(t.amount) AS total
    FROM transaction_categories t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.removed_at IS NULL
      AND t.transaction_type = 'expense'
      AND t.posted_date BETWEEN ${filters.range.start} AND ${filters.range.end}
      AND (${filters.categories}::text[] IS NULL OR lower(t.category) = ANY(${filters.categories}))
      AND (${filters.merchants}::text[] IS NULL OR lower(t.merchant_name) = ANY(${filters.merchants}))
      AND (${filters.accounts}::text[] IS NULL OR lower(a.name) = ANY(${filters.accounts}))
    GROUP BY 1 ORDER BY 1
  ` as unknown as { month: string; count: number; total: number }[];

  if (rows.length === 0) return "No spending in that range.";

  const average = rows.reduce((sum, row) => sum + row.total, 0) / rows.length;
  const lines = rows.map((row) => `${row.month}: ${formatMoney(row.total)} (${row.count} txns)`);

  return `${lines.join("\n")}\nMonthly average: ${formatMoney(average)} over ${rows.length} months`;
}
