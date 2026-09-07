import { db } from "@/db.ts";
import type { FinanceFilters } from "@/finance/financeFilters.ts";
import { formatMoney } from "@/finance/formatMoney.ts";

const DEFAULT_LIMIT = 25;

interface TransactionRow {
  id: string;
  posted_date: Date;
  amount: number;
  transaction_type: string;
  categories: string;
  merchant_name: string | null;
  description: string;
  account: string;
  pending: boolean;
  total_matches: number;
}

// The only query type that does not filter to expenses: when the user is hunting for a specific
// charge, a transfer or a paycheck is a legitimate answer.
//
// Grouped by transaction rather than read straight from the view, because a split charge appears
// there once per part — otherwise the same merchant and date would print on several lines with
// nothing to say they are one purchase. Grouping also makes count(*) OVER () count charges: window
// functions run after GROUP BY, and before LIMIT, so it is the true match count.
//
// Every transaction column is listed in GROUP BY rather than wrapped in min(): Postgres infers
// functional dependency from a table's primary key, and this is a view, so it cannot.
export async function transactionSearch(
  filters: FinanceFilters,
  search?: string,
  limit = DEFAULT_LIMIT,
): Promise<string> {
  const pattern = search ? `%${search}%` : null;

  const rows = await db`
    SELECT t.id, t.posted_date, t.transaction_type, t.merchant_name, t.description,
           t.pending, a.name AS account,
           sum(t.amount) AS amount,
           string_agg(DISTINCT t.category, ' + ') AS categories,
           count(*) OVER ()::int AS total_matches
    FROM transaction_categories t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.removed_at IS NULL
      AND t.posted_date BETWEEN ${filters.range.start} AND ${filters.range.end}
      AND (${pattern}::text IS NULL
           OR t.description ILIKE ${pattern} OR t.merchant_name ILIKE ${pattern})
      AND (${filters.categories}::text[] IS NULL OR lower(t.category) = ANY(${filters.categories}))
      AND (${filters.merchants}::text[] IS NULL OR lower(t.merchant_name) = ANY(${filters.merchants}))
      AND (${filters.accounts}::text[] IS NULL OR lower(a.name) = ANY(${filters.accounts}))
    GROUP BY t.id, t.posted_date, t.transaction_type, t.merchant_name, t.description,
             t.pending, a.name
    ORDER BY t.posted_date DESC, abs(sum(t.amount)) DESC
    LIMIT ${limit}
  ` as unknown as TransactionRow[];

  if (rows.length === 0) return "No matching transactions.";

  const lines = rows.map((row) => {
    const date = row.posted_date.toISOString().slice(0, 10);
    const label = row.merchant_name ?? row.description;
    const kind = row.transaction_type === "expense" ? "" : ` [${row.transaction_type}]`;
    const pending = row.pending ? " (pending)" : "";
    return `${date}  ${formatMoney(row.amount)}  ${label} — ${row.categories}, ${row.account}${kind}${pending}`;
  });

  // Reporting rows.length alone said "25 match(es)" for a month holding 156, and the system prompt
  // tells the model to repeat these figures rather than re-derive them.
  const matched = rows[0].total_matches;
  const header = matched > rows.length
    ? `${matched} matches, showing the ${rows.length} most recent:`
    : `${matched} match(es):`;

  return `${header}\n${lines.join("\n")}`;
}
