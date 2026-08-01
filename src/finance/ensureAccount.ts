import { db } from "@/db.ts";
import { warn } from "@/logger.ts";

// /transactions/sync can report an account that /accounts/balance/get did not return — a closed
// account that still carries history, or a partial balance response. Skipping those transactions
// would drop them permanently, because the cursor commits either way and Plaid never offers them
// again. A placeholder satisfies the foreign key so nothing is lost; the next balance call fills in
// the real name and type through the same ON CONFLICT path upsertAccounts uses.
//
// Written outside the page transaction on purpose: the row must be visible to the foreign key check
// immediately, and an unused placeholder left behind by a rolled-back page is harmless.
export async function ensureAccount(plaidAccountId: string, itemId: string): Promise<string> {
  warn("finance", "Transaction references an unknown account, inserting placeholder", {
    plaidAccountId,
  });

  const rows = await db`
    INSERT INTO accounts (plaid_account_id, item_id, name, type)
    VALUES (${plaidAccountId}, ${itemId}, 'Unknown account', 'unknown')
    ON CONFLICT (plaid_account_id) DO UPDATE SET plaid_account_id = EXCLUDED.plaid_account_id
    RETURNING id
  ` as unknown as { id: string }[];

  return rows[0].id;
}
