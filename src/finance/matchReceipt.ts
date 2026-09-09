import { db } from "@/db.ts";

interface Receipt {
  id: string;
  receipt_total: number;
  purchase_date: string | null;
}

interface MatchResult {
  transactionId: string | null;
  merchantName: string | null;
  postedDate: string | null;
}

export async function matchReceipt(receiptId: string): Promise<MatchResult> {
  const [receipt] = await db`
    SELECT id, receipt_total, purchase_date FROM transaction_receipts
    WHERE id = ${receiptId} AND status = 'unmatched'
  ` as unknown as Receipt[];
  if (!receipt) {
    return { transactionId: null, merchantName: null, postedDate: null };
  }

  const rows = await db`
    SELECT id, merchant_name, posted_date
    FROM transactions
    WHERE amount = ${receipt.receipt_total}
      AND NOT pending
      AND removed_at IS NULL
      AND posted_date BETWEEN
        COALESCE(${receipt.purchase_date}::date - 14, current_date - 60)
        AND COALESCE(${receipt.purchase_date}::date + 14, current_date)
    ORDER BY posted_date DESC
    LIMIT 2
  ` as unknown as {
    id: string;
    merchant_name: string | null;
    posted_date: Date;
  }[];
  if (rows.length !== 1) {
    return { transactionId: null, merchantName: null, postedDate: null };
  }

  const match = rows[0];
  await db`
    UPDATE transaction_receipts
    SET transaction_id = ${match.id}, status = 'awaiting_confirmation', matched_at = now()
    WHERE id = ${receiptId} AND status = 'unmatched'
  `;
  return {
    transactionId: match.id,
    merchantName: match.merchant_name,
    postedDate: match.posted_date.toISOString().slice(0, 10),
  };
}
