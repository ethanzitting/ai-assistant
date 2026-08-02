import { db } from "@/db.ts";
import type { FinanceFilters } from "@/finance/financeFilters.ts";
import { formatMoney } from "@/finance/formatMoney.ts";

const DEFAULT_LIMIT = 25;

interface TransactionRow {
  posted_date: Date;
  amount: number;
  transaction_type: string;
  category: string | null;
  merchant_name: string | null;
  description: string;
  account: string;
  pending: boolean;
}

// The only query type that does not filter to expenses: when the user is hunting for a specific
// charge, a transfer or a paycheck is a legitimate answer.
export async function transactionSearch(
  filters: FinanceFilters,
  search?: string,
  limit = DEFAULT_LIMIT,
): Promise<string> {
  const pattern = search ? `%${search}%` : null;

  const rows = await db`
    SELECT t.posted_date, t.amount, t.transaction_type, t.category,
           t.merchant_name, t.description, a.name AS account, t.pending
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.removed_at IS NULL
      AND t.posted_date BETWEEN ${filters.range.start} AND ${filters.range.end}
      AND (${pattern}::text IS NULL
           OR t.description ILIKE ${pattern} OR t.merchant_name ILIKE ${pattern})
      AND (${filters.categories}::text[] IS NULL OR lower(t.category) = ANY(${filters.categories}))
      AND (${filters.merchants}::text[] IS NULL OR lower(t.merchant_name) = ANY(${filters.merchants}))
      AND (${filters.accounts}::text[] IS NULL OR lower(a.name) = ANY(${filters.accounts}))
    ORDER BY t.posted_date DESC, abs(t.amount) DESC
    LIMIT ${limit}
  ` as unknown as TransactionRow[];

  if (rows.length === 0) return "No matching transactions.";

  const lines = rows.map((row) => {
    const date = row.posted_date.toISOString().slice(0, 10);
    const label = row.merchant_name ?? row.description;
    const kind = row.transaction_type === "expense" ? "" : ` [${row.transaction_type}]`;
    const pending = row.pending ? " (pending)" : "";
    return `${date}  ${formatMoney(row.amount)}  ${label} — ${row.category ?? "uncategorized"}, ${row.account}${kind}${pending}`;
  });

  return `${rows.length} match(es):\n${lines.join("\n")}`;
}
