import { getBotInstance } from "@/telegram/sendTelegramMessage.ts";

export function startTypingIndicator(chatId: number): () => void {
  const bot = getBotInstance();
  if (!bot) return () => {};

  bot.api.sendChatAction(chatId, "typing").catch(() => {});

  const interval = setInterval(() => {
    bot.api.sendChatAction(chatId, "typing").catch(() => {});
  }, 4000);

  return () => clearInterval(interval);
}
