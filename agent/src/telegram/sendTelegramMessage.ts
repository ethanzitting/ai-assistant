import type { Bot } from "grammy";

let botInstance: Bot | null = null;

export function setBotInstance(bot: Bot): void {
  botInstance = bot;
}

export async function sendTelegramMessage(
  chatId: number,
  text: string,
): Promise<void> {
  if (!botInstance) {
    console.log(`[telegram] Bot not initialized. Would send to ${chatId}: ${text}`);
    return;
  }

  await botInstance.api.sendMessage(chatId, text);
}
