import { db } from "@/db.ts";
import { matchReceipt } from "@/finance/matchReceipt.ts";

export async function matchUnmatchedReceipts(): Promise<number> {
  const receipts = await db`
    SELECT id FROM transaction_receipts WHERE status = 'unmatched' ORDER BY created_at
  ` as unknown as { id: string }[];

  let matched = 0;
  for (const receipt of receipts) {
    const result = await matchReceipt(receipt.id);
    if (result.transactionId) matched++;
  }
  return matched;
}
