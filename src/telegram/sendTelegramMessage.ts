import type { Bot } from "grammy";
import { warn } from "@/logger.ts";

let botInstance: Bot | null = null;

export function setBotInstance(bot: Bot): void {
  botInstance = bot;
}

export async function sendTelegramMessage(
  chatId: number,
  text: string,
): Promise<void> {
  if (!botInstance) {
    warn("telegram", "Bot not initialized", { chatId });
    return;
  }

  await botInstance.api.sendMessage(chatId, text);
}
