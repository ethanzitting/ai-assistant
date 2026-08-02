import { db } from "@/db.ts";
import { getBotInstance } from "@/telegram/sendTelegramMessage.ts";
import { categoryKeyboard, loadCategoryOptions } from "@/finance/categoryKeyboard.ts";
import { loadCategorySuggestions } from "@/finance/loadCategorySuggestions.ts";
import { formatMoney } from "@/finance/formatMoney.ts";
import { warn } from "@/logger.ts";

export interface PendingCharge {
  id: string;
  posted_date: Date;
  amount: number;
  merchant_name: string | null;
  description: string;
  account: string;
}

export async function sendCategoryPrompt(chatId: number, charge: PendingCharge): Promise<boolean> {
  const bot = getBotInstance();
  if (!bot) {
    warn("finance", "Bot not initialized, cannot send category prompt");
    return false;
  }

  // The prompt row is written first so its id can go into the callback payload.
  const [{ id: promptId }] = await db`
    INSERT INTO categorization_prompts (transaction_id) VALUES (${charge.id})
    ON CONFLICT (transaction_id) DO UPDATE SET sent_at = now(), answered_at = NULL
    RETURNING id
  ` as unknown as [{ id: number }];

  const [options, suggested] = await Promise.all([
    loadCategoryOptions(),
    loadCategorySuggestions(charge.merchant_name),
  ]);

  try {
    const message = await bot.api.sendMessage(
      chatId,
      describeCharge(charge),
      { reply_markup: categoryKeyboard(promptId, options, suggested) },
    );
    await db`
      UPDATE categorization_prompts SET telegram_message_id = ${message.message_id}
      WHERE id = ${promptId}
    `;
    return true;
  } catch (err: unknown) {
    warn("finance", "Failed to send category prompt", {
      chargeId: charge.id,
      error: err instanceof Error ? err.message : String(err),
    });
    // Leave no prompt row behind, or the charge is never offered again.
    await db`DELETE FROM categorization_prompts WHERE id = ${promptId}`;
    return false;
  }
}

function describeCharge(charge: PendingCharge): string {
  const label = charge.merchant_name ?? charge.description;
  const date = charge.posted_date.toISOString().slice(0, 10);
  return `${formatMoney(charge.amount)} — ${label}\n${date} · ${charge.account}`;
}
