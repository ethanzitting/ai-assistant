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

  for (const chunk of splitMessage(text)) {
    await botInstance.api.sendMessage(chatId, chunk);
  }
}

const MAX_LENGTH = 4096;

function splitMessage(text: string): string[] {
  if (text.length <= MAX_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > MAX_LENGTH) {
    let splitAt = remaining.lastIndexOf("\n\n", MAX_LENGTH);
    if (splitAt < 1) splitAt = remaining.lastIndexOf("\n", MAX_LENGTH);
    if (splitAt < 1) splitAt = remaining.lastIndexOf(" ", MAX_LENGTH);
    if (splitAt < 1) splitAt = MAX_LENGTH;

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}
