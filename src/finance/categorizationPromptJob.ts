import { db } from "@/db.ts";
import { resolveChatId } from "@/telegram/resolveChatId.ts";
import {
  type PendingCharge,
  sendCategorizationBatch,
} from "@/finance/sendCategorizationBatch.ts";
import { info, warn } from "@/logger.ts";

// A week of silence should not produce a wall of messages. The remainder carries to tomorrow,
// oldest first, so nothing is lost and nothing arrives in bulk.
const MAX_PROMPTS_PER_NIGHT = 10;

export async function categorizationPromptJob(): Promise<
  Record<string, unknown>
> {
  const chatId = await resolveChatId();
  if (!chatId) {
    warn("finance", "No private chat, skipping categorization prompts");
    return { skipped: "no_private_chat" };
  }

  const charges = await pendingCharges();
  if (charges.length === 0) return { prompted: 0 };

  const sent = await sendCategorizationBatch(chatId, charges);

  info("finance", "Sent categorization batch", {
    sent,
    queued: charges.length,
  });
  return { prompted: sent ? charges.length : 0, queued: charges.length };
}

// pending = false is load-bearing. A pending charge posts as a NEW transaction_id carrying
// pending_transaction_id, so prompting on the pending row would ask twice for one purchase and
// discard the first answer when the pending row is retired. Waiting for the charge to post costs
// a night or two and removes the whole class of bug.
async function pendingCharges(): Promise<PendingCharge[]> {
  return await db`
    SELECT t.id, t.posted_date AS "postedDate", t.amount, t.merchant_name AS "merchantName",
      t.description, a.name AS account,
      EXISTS (
        SELECT 1 FROM transaction_receipts r
        WHERE r.transaction_id = t.id AND r.status = 'awaiting_confirmation'
      ) AS "receiptMatchWaiting"
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.needs_category
      AND NOT t.pending
      AND t.removed_at IS NULL
      AND NOT EXISTS (
      SELECT 1 FROM categorization_batch_items i
      WHERE i.transaction_id = t.id AND i.answered_at IS NULL
      )
    ORDER BY t.posted_date, t.id
    LIMIT ${MAX_PROMPTS_PER_NIGHT}
  ` as unknown as PendingCharge[];
}
