import { db } from "@/db.ts";
import {
  type PendingCharge,
  sendCategorizationBatch,
} from "@/finance/sendCategorizationBatch.ts";

const BATCH_SIZE = 10;

export interface SendNextFinanceAuditBatchArgs {
  auditId: string;
  chatId: number;
}

export async function sendNextFinanceAuditBatch(
  args: SendNextFinanceAuditBatchArgs,
): Promise<number> {
  const charges = await db`
    SELECT t.id, t.posted_date AS "postedDate", t.amount,
      t.merchant_name AS "merchantName", t.description, a.name AS account,
      EXISTS (
        SELECT 1 FROM transaction_receipts r
        WHERE r.transaction_id = t.id AND r.status = 'awaiting_confirmation'
      ) AS "receiptMatchWaiting"
    FROM finance_audit_items i
    JOIN transactions t ON t.id = i.transaction_id
    JOIN accounts a ON a.id = t.account_id
    WHERE i.audit_id = ${args.auditId}
      AND t.needs_category
      AND t.transaction_type = 'expense'
      AND NOT t.pending
      AND t.removed_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM categorization_batch_items b
        WHERE b.transaction_id = t.id AND b.answered_at IS NULL
      )
    ORDER BY t.posted_date, t.id
    LIMIT ${BATCH_SIZE}
  ` as unknown as PendingCharge[];

  if (charges.length === 0) return 0;
  return await sendCategorizationBatch(args.chatId, charges)
    ? charges.length
    : 0;
}
