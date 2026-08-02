import { db } from "@/db.ts";
import type { FinanceFilters } from "@/finance/financeFilters.ts";
import { formatMoney } from "@/finance/formatMoney.ts";

interface CategoryRow {
  category: string | null;
  count: number;
  total: number;
}

export async function spendingByCategory(filters: FinanceFilters): Promise<string> {
  const rows = await db`
    SELECT coalesce(t.category, 'uncategorized') AS category,
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
    GROUP BY 1
    ORDER BY sum(t.amount) DESC
  ` as unknown as CategoryRow[];

  if (rows.length === 0) return "No spending in that range.";

  const grandTotal = rows.reduce((sum, row) => sum + row.total, 0);

  // Shares only mean something against a positive total. A refund-heavy range sums to zero or
  // below, which would divide by zero or print negative percentages that read as real figures.
  const showShare = grandTotal > 0;

  const lines = rows.map((row) => {
    const share = showShare ? `${((row.total / grandTotal) * 100).toFixed(0)}%, ` : "";
    return `${row.category}: ${formatMoney(row.total)} (${share}${row.count} txns)`;
  });

  return `${lines.join("\n")}\nTotal: ${formatMoney(grandTotal)}`;
}
