import { db } from "@/db.ts";
import type { BalancesResponse } from "@/plaid/fetchBalances.ts";

// Plaid only populates balances.last_updated_datetime for a single institution, so the sync time is
// the honest stamp for when these numbers were true.
export async function upsertAccounts(balances: BalancesResponse): Promise<Map<string, string>> {
  await db`
    INSERT INTO plaid_items (item_id, institution_name)
    VALUES (${balances.item.item_id}, ${balances.item.institution_name ?? null})
    ON CONFLICT (item_id) DO UPDATE SET
      institution_name = COALESCE(EXCLUDED.institution_name, plaid_items.institution_name),
      status = 'active'
  `;

  const accountIdByPlaidId = new Map<string, string>();

  for (const account of balances.accounts) {
    const rows = await db`
      INSERT INTO accounts (
        plaid_account_id, item_id, name, official_name, mask, type, subtype,
        current_balance, available_balance, credit_limit, currency_code, balance_as_of
      ) VALUES (
        ${account.account_id}, ${balances.item.item_id}, ${account.name},
        ${account.official_name}, ${account.mask}, ${account.type}, ${account.subtype},
        ${account.balances.current}, ${account.balances.available}, ${account.balances.limit},
        ${account.balances.iso_currency_code}, now()
      )
      ON CONFLICT (plaid_account_id) DO UPDATE SET
        name              = EXCLUDED.name,
        official_name     = EXCLUDED.official_name,
        mask              = EXCLUDED.mask,
        type              = EXCLUDED.type,
        subtype           = EXCLUDED.subtype,
        current_balance   = EXCLUDED.current_balance,
        available_balance = EXCLUDED.available_balance,
        credit_limit      = EXCLUDED.credit_limit,
        currency_code     = EXCLUDED.currency_code,
        balance_as_of     = EXCLUDED.balance_as_of
      RETURNING id
    ` as unknown as { id: string }[];

    accountIdByPlaidId.set(account.account_id, rows[0].id);
  }

  return accountIdByPlaidId;
}
