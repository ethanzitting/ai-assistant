import { db } from "@/db.ts";
import { requireEnv } from "@/requireEnv.ts";
import { fetchBalances } from "@/plaid/fetchBalances.ts";
import { fetchTransactionPage } from "@/plaid/fetchTransactionPage.ts";
import { upsertAccounts } from "@/finance/upsertAccounts.ts";
import { applyTransactionPage } from "@/finance/applyTransactionPage.ts";
import type { CategoryRule } from "@/finance/resolveCategory.ts";
import { info, warn } from "@/logger.ts";

// A first sync of several years of history is a few dozen pages. This ceiling only exists so a
// Plaid bug that never clears has_more cannot loop until the container dies.
const MAX_PAGES = 200;

export interface PlaidSyncResult {
  itemId: string;
  accounts: number;
  pages: number;
  added: number;
  modified: number;
  removed: number;
  // False when the page ceiling cut the run short. No data is lost — the next run resumes from the
  // committed cursor — but the run is not the full picture and should not read as finished.
  caughtUp: boolean;
}

export async function runPlaidSync(): Promise<PlaidSyncResult> {
  const accessToken = requireEnv("PLAID_ACCESS_TOKEN");

  const balances = await fetchBalances(accessToken);
  const accountIdByPlaidId = await upsertAccounts(balances);
  const rules = await loadCategoryRules();

  const itemId = balances.item.item_id;
  const result: PlaidSyncResult = {
    itemId,
    accounts: balances.accounts.length,
    pages: 0,
    added: 0,
    modified: 0,
    removed: 0,
    caughtUp: false,
  };

  let cursor = await loadCursor(itemId);

  while (result.pages < MAX_PAGES) {
    const page = await fetchTransactionPage(accessToken, cursor);
    await applyTransactionPage({ page, itemId, accountIdByPlaidId, rules });

    result.pages++;
    result.added += page.added.length;
    result.modified += page.modified.length;
    result.removed += page.removed.length;

    if (!page.has_more) {
      result.caughtUp = true;
      break;
    }
    cursor = page.next_cursor;
  }

  if (!result.caughtUp) {
    warn("finance", "Stopped at the page ceiling with more to fetch", { pages: result.pages });
  }

  info("finance", "Plaid sync complete", { ...result });
  return result;
}

async function loadCursor(itemId: string): Promise<string | null> {
  const rows = await db`
    SELECT transactions_cursor FROM plaid_items WHERE item_id = ${itemId}
  `;
  if (rows.length === 0) return null;
  return (rows[0].transactions_cursor as string | null) ?? null;
}

async function loadCategoryRules(): Promise<CategoryRule[]> {
  return await db`
    SELECT match_type, match_value, category FROM category_rules ORDER BY created_at
  ` as unknown as CategoryRule[];
}
