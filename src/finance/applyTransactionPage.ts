import { db } from "@/db.ts";
import type { TransactionPage } from "@/plaid/fetchTransactionPage.ts";
import type { CategoryRule } from "@/finance/resolveCategory.ts";
import { toTransactionRow } from "@/finance/toTransactionRow.ts";
import { ensureAccount } from "@/finance/ensureAccount.ts";

export interface ApplyTransactionPageArgs {
  page: TransactionPage;
  itemId: string;
  accountIdByPlaidId: Map<string, string>;
  rules: CategoryRule[];
}

// The page and its cursor commit together. A hot reload or a crash between the two would otherwise
// advance the cursor past transactions that were never written, and Plaid would never offer them
// again — a silent, permanent gap. Because every write is an upsert keyed on plaid_transaction_id,
// replaying an uncommitted page costs nothing.
export async function applyTransactionPage(args: ApplyTransactionPageArgs): Promise<void> {
  await db.begin(async (tx) => {
    for (const transaction of [...args.page.added, ...args.page.modified]) {
      let accountId = args.accountIdByPlaidId.get(transaction.account_id);
      if (!accountId) {
        accountId = await ensureAccount(transaction.account_id, args.itemId);
        args.accountIdByPlaidId.set(transaction.account_id, accountId);
      }

      const row = toTransactionRow({ transaction, accountId, rules: args.rules });
      const values = { ...row, properties: tx.json(row.properties as never) };

      await tx`
        INSERT INTO transactions ${tx(values)}
        ON CONFLICT (plaid_transaction_id) DO UPDATE SET
          account_id              = EXCLUDED.account_id,
          posted_date             = EXCLUDED.posted_date,
          authorized_date         = EXCLUDED.authorized_date,
          amount                  = EXCLUDED.amount,
          currency_code           = EXCLUDED.currency_code,
          description             = EXCLUDED.description,
          merchant_name           = EXCLUDED.merchant_name,
          plaid_category_primary  = EXCLUDED.plaid_category_primary,
          plaid_category_detailed = EXCLUDED.plaid_category_detailed,
          transaction_type        = EXCLUDED.transaction_type,
          payment_channel         = EXCLUDED.payment_channel,
          pending                 = EXCLUDED.pending,
          properties              = transactions.properties || EXCLUDED.properties,
          removed_at              = NULL,
          updated_at              = now(),
          -- Plaid re-sends a transaction whenever its amount or merchant changes after posting.
          -- Anything already categorized — by a rule, a button, or a split — must survive that,
          -- or an answer given last night is silently thrown away today. "Not Unsorted" is the
          -- test, because it holds regardless of which path assigned the category.
          category = CASE WHEN transactions.category IS DISTINCT FROM 'Unsorted'
                          THEN transactions.category ELSE EXCLUDED.category END,
          category_source = CASE WHEN transactions.category IS DISTINCT FROM 'Unsorted'
                          THEN transactions.category_source ELSE EXCLUDED.category_source END,
          needs_category = CASE WHEN transactions.category IS DISTINCT FROM 'Unsorted'
                          THEN false ELSE EXCLUDED.needs_category END
      `;

      // A posted transaction names the pending row it settles. Retiring that row is what stops the
      // same charge from counting twice.
      if (transaction.pending_transaction_id) {
        await tx`
          UPDATE transactions SET removed_at = now(), updated_at = now()
          WHERE plaid_transaction_id = ${transaction.pending_transaction_id}
            AND removed_at IS NULL
        `;
      }
    }

    for (const removed of args.page.removed) {
      await tx`
        UPDATE transactions SET removed_at = now(), updated_at = now()
        WHERE plaid_transaction_id = ${removed.transaction_id}
          AND removed_at IS NULL
      `;
    }

    await tx`
      UPDATE plaid_items
      SET transactions_cursor = ${args.page.next_cursor}, last_synced_at = now()
      WHERE item_id = ${args.itemId}
    `;
  });
}
