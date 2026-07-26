import { getBotInstance } from "@/telegram/sendTelegramMessage.ts";
import { warn } from "@/logger.ts";

const MAX_PHOTO_CAPTION_LENGTH = 1024;

// Telegram accepts a file_id in place of an upload, so re-sending an archived photo needs no
// bytes — not from B2, not from disk. sendPhoto recompresses and can reject an image whose
// dimensions or aspect ratio it dislikes, so sendDocument is the fallback: same file_id, no
// recompression, delivered as a file card.
export async function sendTelegramPhoto(
  chatId: number,
  telegramFileId: string,
  caption?: string,
): Promise<void> {
  const bot = getBotInstance();
  if (!bot) throw new Error("Bot not initialized");

  const trimmedCaption = caption?.slice(0, MAX_PHOTO_CAPTION_LENGTH);

  try {
    await bot.api.sendPhoto(chatId, telegramFileId, { caption: trimmedCaption });
  } catch (err: unknown) {
    warn("telegram", "sendPhoto failed, falling back to document", {
      error: err instanceof Error ? err.message : String(err),
    });
    await bot.api.sendDocument(chatId, telegramFileId, { caption: trimmedCaption });
  }
}
