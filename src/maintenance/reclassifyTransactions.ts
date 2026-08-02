// reclassifyTransactions — re-derive transaction_type for every stored transaction.
//
// transaction_type is derived entirely from Plaid's category and the amount, so whenever the rules
// in classifyTransactionType change, history is stale. /transactions/sync will not help: it only
// resends transactions that Plaid itself changed. This applies the current rules to rows already
// stored, using the same function the ingest path uses, so the two can never drift.
//
// Idempotent and safe to re-run — it recomputes rather than accumulates.
//
// Run inside the agent container:  make reclassify-transactions
import { db } from "@/db.ts";
import { classifyTransactionType } from "@/finance/classifyTransactionType.ts";

interface Row {
  id: string;
  plaid_category_primary: string | null;
  plaid_category_detailed: string | null;
  amount: number;
  transaction_type: string;
}

const rows = await db`
  SELECT id, plaid_category_primary, plaid_category_detailed, amount, transaction_type
  FROM transactions
` as unknown as Row[];

const idsByNewType = new Map<string, string[]>();
const movesSeen = new Map<string, number>();

for (const row of rows) {
  const nextType = classifyTransactionType({
    plaidCategoryPrimary: row.plaid_category_primary,
    plaidCategoryDetailed: row.plaid_category_detailed,
    amount: row.amount,
  });
  if (nextType === row.transaction_type) continue;

  const ids = idsByNewType.get(nextType) ?? [];
  ids.push(row.id);
  idsByNewType.set(nextType, ids);

  const move = `${row.transaction_type} → ${nextType}`;
  movesSeen.set(move, (movesSeen.get(move) ?? 0) + 1);
}

let changed = 0;
for (const [nextType, ids] of idsByNewType) {
  await db`
    UPDATE transactions SET transaction_type = ${nextType}, updated_at = now()
    WHERE id = ANY(${ids}::uuid[])
  `;
  changed += ids.length;
}

console.log(`Examined ${rows.length} transactions, reclassified ${changed}.`);
for (const [move, count] of movesSeen) console.log(`  ${move}: ${count}`);

await db.end();
