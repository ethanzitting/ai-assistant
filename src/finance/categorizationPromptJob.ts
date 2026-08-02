import { db } from "@/db.ts";
import { resolveChatId } from "@/telegram/resolveChatId.ts";
import { sendCategoryPrompt, type PendingCharge } from "@/finance/sendCategoryPrompt.ts";
import { info, warn } from "@/logger.ts";

// A week of silence should not produce a wall of messages. The remainder carries to tomorrow,
// oldest first, so nothing is lost and nothing arrives in bulk.
const MAX_PROMPTS_PER_NIGHT = 10;

export async function categorizationPromptJob(): Promise<Record<string, unknown>> {
  const chatId = await resolveChatId();
  if (!chatId) {
    warn("finance", "No private chat, skipping categorization prompts");
    return { skipped: "no_private_chat" };
  }

  const charges = await pendingCharges();
  if (charges.length === 0) return { prompted: 0 };

  let sent = 0;
  for (const charge of charges) {
    if (await sendCategoryPrompt(chatId, charge)) sent++;
  }

  info("finance", "Sent categorization prompts", { sent, queued: charges.length });
  return { prompted: sent, queued: charges.length };
}

// pending = false is load-bearing. A pending charge posts as a NEW transaction_id carrying
// pending_transaction_id, so prompting on the pending row would ask twice for one purchase and
// discard the first answer when the pending row is retired. Waiting for the charge to post costs
// a night or two and removes the whole class of bug.
async function pendingCharges(): Promise<PendingCharge[]> {
  return await db`
    SELECT t.id, t.posted_date, t.amount, t.merchant_name, t.description, a.name AS account
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.needs_category
      AND NOT t.pending
      AND t.removed_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM categorization_prompts p
        WHERE p.transaction_id = t.id AND p.answered_at IS NULL
      )
    ORDER BY t.posted_date, t.id
    LIMIT ${MAX_PROMPTS_PER_NIGHT}
  ` as unknown as PendingCharge[];
}
