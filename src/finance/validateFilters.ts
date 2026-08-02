import { db } from "@/db.ts";
import type { FinanceFilters } from "@/finance/financeFilters.ts";
import { unknownValues } from "@/finance/unknownValues.ts";

const MAX_MERCHANT_SUGGESTIONS = 5;

// A filter value that does not exist returns zero rows, which is indistinguishable from genuinely
// having spent nothing — asking for "food & drink" when the stored name is "food and drink"
// answered "$0.00 across 0 transactions". Vocabulary is checked against the whole table, never the
// requested date range, so a real category with no spending that month still reports a true zero.
export async function validateFilters(filters: FinanceFilters): Promise<string | null> {
  const problems: string[] = [];

  if (filters.categories) {
    const known = await distinctCategories();
    const unknown = unknownValues(filters.categories, known);
    if (unknown.length > 0) {
      problems.push(
        `No such category: ${quote(unknown)}. Categories in use: ${known.join(", ")}.`,
      );
    }
  }

  if (filters.accounts) {
    const known = await distinctAccounts();
    const unknown = unknownValues(filters.accounts, known);
    if (unknown.length > 0) {
      problems.push(`No such account: ${quote(unknown)}. Accounts: ${known.join(", ")}.`);
    }
  }

  if (filters.merchants) {
    for (const merchant of filters.merchants) {
      const problem = await checkMerchant(merchant);
      if (problem) problems.push(problem);
    }
  }

  if (problems.length === 0) return null;
  return `${problems.join("\n")}\nRe-run with a corrected filter — this is not a zero result.`;
}

// Merchants are unbounded, so listing them all would be useless. Suggest near matches instead.
async function checkMerchant(merchant: string): Promise<string | null> {
  const [{ count }] = await db`
    SELECT count(*)::int AS count FROM transactions
    WHERE removed_at IS NULL AND lower(merchant_name) = ${merchant}
  ` as unknown as [{ count: number }];
  if (count > 0) return null;

  const rows = await db`
    SELECT DISTINCT merchant_name FROM transactions
    WHERE removed_at IS NULL AND merchant_name ILIKE ${"%" + merchant + "%"}
    ORDER BY merchant_name LIMIT ${MAX_MERCHANT_SUGGESTIONS}
  ` as unknown as { merchant_name: string }[];

  if (rows.length === 0) return `No merchant matches "${merchant}".`;
  return `No merchant named exactly "${merchant}". Close matches: ${
    rows.map((row) => row.merchant_name).join(", ")
  }.`;
}

async function distinctCategories(): Promise<string[]> {
  const rows = await db`
    SELECT DISTINCT lower(category) AS value FROM transactions
    WHERE removed_at IS NULL AND category IS NOT NULL ORDER BY 1
  ` as unknown as { value: string }[];
  return rows.map((row) => row.value);
}

async function distinctAccounts(): Promise<string[]> {
  const rows = await db`SELECT lower(name) AS value FROM accounts ORDER BY 1` as unknown as {
    value: string;
  }[];
  return rows.map((row) => row.value);
}

function quote(values: string[]): string {
  return values.map((value) => `"${value}"`).join(", ");
}
