import { db } from "@/db.ts";
import type { PlaidAccountsResponse } from "@/plaid/fetchAccounts.ts";

export interface UpsertAccountsArgs {
  response: PlaidAccountsResponse;
  updateBalances: boolean;
}

export async function upsertAccounts(
  args: UpsertAccountsArgs,
): Promise<Map<string, string>> {
  const { response, updateBalances } = args;

  await db`
    INSERT INTO plaid_items (item_id, institution_name)
    VALUES (${response.item.item_id}, ${response.item.institution_name ?? null})
    ON CONFLICT (item_id) DO UPDATE SET
      institution_name = COALESCE(EXCLUDED.institution_name, plaid_items.institution_name),
      status = 'active'
  `;

  const accountIdByPlaidId = new Map<string, string>();

  for (const account of response.accounts) {
    const rows = await db`
      INSERT INTO accounts (
        plaid_account_id, item_id, name, official_name, mask, type, subtype,
        current_balance, available_balance, credit_limit, currency_code, balance_as_of
      ) VALUES (
        ${account.account_id}, ${response.item.item_id}, ${account.name},
        ${account.official_name}, ${account.mask}, ${account.type}, ${account.subtype},
        ${account.balances.current}, ${account.balances.available}, ${account.balances.limit},
        ${account.balances.iso_currency_code},
        CASE WHEN ${updateBalances} THEN now() ELSE NULL END
      )
      ON CONFLICT (plaid_account_id) DO UPDATE SET
        name              = EXCLUDED.name,
        official_name     = EXCLUDED.official_name,
        mask              = EXCLUDED.mask,
        type              = EXCLUDED.type,
        subtype           = EXCLUDED.subtype,
        current_balance   = CASE WHEN ${updateBalances}
                            THEN EXCLUDED.current_balance ELSE accounts.current_balance END,
        available_balance = CASE WHEN ${updateBalances}
                            THEN EXCLUDED.available_balance ELSE accounts.available_balance END,
        credit_limit      = CASE WHEN ${updateBalances}
                            THEN EXCLUDED.credit_limit ELSE accounts.credit_limit END,
        currency_code     = EXCLUDED.currency_code,
        balance_as_of     = CASE WHEN ${updateBalances}
                            THEN EXCLUDED.balance_as_of ELSE accounts.balance_as_of END
      RETURNING id
    ` as unknown as { id: string }[];

    accountIdByPlaidId.set(account.account_id, rows[0].id);
  }

  return accountIdByPlaidId;
}
