import { db } from "@/db.ts";
import { formatMoney } from "@/finance/formatMoney.ts";
import { getBotInstance } from "@/telegram/sendTelegramMessage.ts";
import { warn } from "@/logger.ts";

export interface PendingCharge {
  id: string;
  postedDate: Date;
  amount: number;
  merchantName: string | null;
  description: string;
  account: string;
  receiptMatchWaiting: boolean;
}

export async function sendCategorizationBatch(
  chatId: number,
  charges: PendingCharge[],
): Promise<boolean> {
  const bot = getBotInstance();
  if (!bot) {
    warn("finance", "Bot not initialized, cannot send categorization batch");
    return false;
  }

  const batchId = await createBatch(charges);
  try {
    const message = await bot.api.sendMessage(chatId, describeBatch(charges));
    await db`
      UPDATE categorization_batches SET telegram_message_id = ${message.message_id}
      WHERE id = ${batchId}
    `;
    return true;
  } catch (err: unknown) {
    await db`DELETE FROM categorization_batches WHERE id = ${batchId}`;
    warn("finance", "Failed to send categorization batch", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

async function createBatch(charges: PendingCharge[]): Promise<string> {
  return await db.begin(async (tx) => {
    const [{ id: batchId }] = await tx`
      INSERT INTO categorization_batches DEFAULT VALUES RETURNING id
    ` as unknown as [{ id: string }];

    for (const [index, charge] of charges.entries()) {
      await tx`
        INSERT INTO categorization_batch_items (batch_id, transaction_id, label)
        VALUES (${batchId}, ${charge.id}, ${labelFor(index)})
      `;
    }
    return batchId;
  });
}

function describeBatch(charges: PendingCharge[]): string {
  const lines = charges.map((charge, index) => {
    const label = labelFor(index);
    const merchant = charge.merchantName ?? charge.description;
    const date = charge.postedDate.toISOString().slice(0, 10);
    const receiptNote = charge.receiptMatchWaiting
      ? " — receipt match waiting for confirmation"
      : "";
    return `${label}. ${merchant} — ${
      formatMoney(charge.amount)
    } — ${date}${receiptNote}`;
  });
  return `Charges that need categories:\n\n${lines.join("\n")}\n\n` +
    'Reply in normal language. For example: "A was groceries; B was $20 groceries and $15 household items; always file C as Car Fuel; keep asking about D." You can also reply with a receipt photo.';
}

function labelFor(index: number): string {
  return String.fromCharCode("A".charCodeAt(0) + index);
}
