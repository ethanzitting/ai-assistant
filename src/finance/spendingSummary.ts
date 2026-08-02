import { db } from "@/db.ts";
import type { FinanceFilters } from "@/finance/financeFilters.ts";
import { spendingTotal } from "@/finance/spendingTotal.ts";
import { comparisonRange, type ComparisonKind } from "@/finance/comparisonRange.ts";
import { formatMoney } from "@/finance/formatMoney.ts";

const TOP_CATEGORIES = 5;

export async function spendingSummary(
  filters: FinanceFilters,
  compareTo?: ComparisonKind,
): Promise<string> {
  const current = await spendingTotal(filters);

  const lines = [
    `${filters.range.start} to ${filters.range.end}`,
    `Total spent: ${formatMoney(current.total)} across ${current.count} transactions`,
  ];

  const days = dayCount(filters);
  if (days > 0) lines.push(`Daily average: ${formatMoney(current.total / days)}`);

  const topCategories = await topCategoryLine(filters);
  if (topCategories) lines.push(`Top: ${topCategories}`);

  if (compareTo) lines.push(await comparisonLine(filters, compareTo, current.total));

  return lines.join("\n");
}

function dayCount(filters: FinanceFilters): number {
  const span = Date.parse(`${filters.range.end}T00:00:00Z`) -
    Date.parse(`${filters.range.start}T00:00:00Z`);
  return Math.round(span / 86_400_000) + 1;
}

async function topCategoryLine(filters: FinanceFilters): Promise<string | null> {
  const rows = await db`
    SELECT coalesce(t.category, 'uncategorized') AS category, sum(t.amount) AS total
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.removed_at IS NULL
      AND t.transaction_type = 'expense'
      AND t.posted_date BETWEEN ${filters.range.start} AND ${filters.range.end}
      AND (${filters.categories}::text[] IS NULL OR lower(t.category) = ANY(${filters.categories}))
      AND (${filters.merchants}::text[] IS NULL OR lower(t.merchant_name) = ANY(${filters.merchants}))
      AND (${filters.accounts}::text[] IS NULL OR lower(a.name) = ANY(${filters.accounts}))
    GROUP BY 1 ORDER BY sum(t.amount) DESC LIMIT ${TOP_CATEGORIES}
  ` as unknown as { category: string; total: number }[];

  if (rows.length === 0) return null;
  return rows.map((row) => `${row.category} ${formatMoney(row.total)}`).join(" · ");
}

async function comparisonLine(
  filters: FinanceFilters,
  compareTo: ComparisonKind,
  currentTotal: number,
): Promise<string> {
  const previousRange = comparisonRange(filters.range, compareTo);
  const previous = await spendingTotal({ ...filters, range: previousRange });

  const label = `${previousRange.start} to ${previousRange.end}: ${formatMoney(previous.total)}`;
  if (previous.total === 0) return `Compared with ${label} (no basis for a percentage)`;

  const change = ((currentTotal - previous.total) / Math.abs(previous.total)) * 100;
  const direction = change >= 0 ? "+" : "";
  return `Compared with ${label} (${direction}${change.toFixed(1)}%)`;
}
