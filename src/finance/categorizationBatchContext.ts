import { db } from "@/db.ts";
import { formatMoney } from "@/finance/formatMoney.ts";

interface BatchItem {
  batch_id: string;
  label: string;
  transaction_id: string;
  amount: number;
  merchant_name: string | null;
  description: string;
  posted_date: Date;
}

export async function categorizationBatchContext(
  telegramMessageId: number | undefined,
): Promise<string | null> {
  if (!telegramMessageId) return null;

  const items = await db`
    SELECT b.id AS batch_id, i.label, t.id AS transaction_id, t.amount, t.merchant_name,
      t.description, t.posted_date
    FROM categorization_batches b
    JOIN categorization_batch_items i ON i.batch_id = b.id
    JOIN transactions t ON t.id = i.transaction_id
    WHERE b.telegram_message_id = ${telegramMessageId} AND i.answered_at IS NULL
    ORDER BY i.label
  ` as unknown as BatchItem[];
  if (items.length === 0) return null;

  const batchId = items[0].batch_id;
  const charges = items.map((item) => ({
    label: item.label,
    transaction_id: item.transaction_id,
    merchant: item.merchant_name ?? item.description,
    amount: formatMoney(item.amount),
    posted_date: item.posted_date.toISOString().slice(0, 10),
  }));
  return `[FINANCE CATEGORIZATION BATCH]\nbatch_id: ${batchId}\n` +
    "The user replied to this batch. Map labels to transaction_id and use categorize_transactions for clear single categories. " +
    "Use split_transaction for a split. Create a vendor rule only when the user says always or keep asking.\n" +
    JSON.stringify(charges);
}
