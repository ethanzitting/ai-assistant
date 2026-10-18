import { db } from "@/db.ts";
import {
  type ReceiptMatchCandidate,
  selectReceiptMatch,
} from "@/finance/selectReceiptMatch.ts";

interface Receipt {
  id: string;
  receipt_total: number;
  purchase_date: string | null;
  merchant_name: string | null;
  source: string;
}

interface MatchResult {
  transactionId: string | null;
  merchantName: string | null;
  postedDate: string | null;
}

export async function matchReceipt(receiptId: string): Promise<MatchResult> {
  const [receipt] = await db`
    SELECT id, receipt_total, purchase_date, merchant_name, source
    FROM transaction_receipts
    WHERE id = ${receiptId} AND status = 'unmatched'
  ` as unknown as Receipt[];
  if (!receipt) {
    return { transactionId: null, merchantName: null, postedDate: null };
  }

  const candidates = await db`
    SELECT t.id AS "transactionId", t.merchant_name AS "merchantName",
      t.posted_date AS "postedDate",
      CASE WHEN ${receipt.purchase_date}::date IS NULL THEN NULL
           ELSE abs(t.posted_date - ${receipt.purchase_date}::date)::int
      END AS "dateDistance"
    FROM transactions t
    WHERE t.amount = ${receipt.receipt_total}
      AND NOT t.pending
      AND t.removed_at IS NULL
      AND t.posted_date BETWEEN
        COALESCE(${receipt.purchase_date}::date - 14, current_date - 60)
        AND COALESCE(${receipt.purchase_date}::date + 14, current_date)
      AND (
        ${receipt.source} = 'telegram_photo'
        OR ${receipt.merchant_name}::text IS NULL
        OR regexp_replace(lower(COALESCE(t.merchant_name, t.description)),
                          '[^a-z0-9]', '', 'g')
           LIKE '%' || regexp_replace(lower(${receipt.merchant_name}),
                                      '[^a-z0-9]', '', 'g') || '%'
      )
      AND NOT EXISTS (
        SELECT 1 FROM transaction_receipts linked
        WHERE linked.transaction_id = t.id
          AND linked.id <> ${receipt.id}
          AND linked.status IN ('awaiting_confirmation', 'confirmed')
      )
    ORDER BY "dateDistance" NULLS LAST, t.posted_date DESC
    LIMIT 2
  ` as unknown as ReceiptMatchCandidate[];
  const match = selectReceiptMatch(candidates);
  if (!match) {
    return { transactionId: null, merchantName: null, postedDate: null };
  }

  await db`
    UPDATE transaction_receipts
    SET transaction_id = ${match.transactionId}, status = 'awaiting_confirmation', matched_at = now()
    WHERE id = ${receiptId} AND status = 'unmatched'
  `;
  return {
    transactionId: match.transactionId,
    merchantName: match.merchantName,
    postedDate: match.postedDate.toISOString().slice(0, 10),
  };
}
