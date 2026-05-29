import type { ToolDefinition } from "@/tools/toolTypes.ts";
import { sendTelegramMessage } from "@/telegram/sendTelegramMessage.ts";
import { db } from "@/db.ts";
import { warn } from "@/logger.ts";

export const messagingTool: ToolDefinition = {
  schema: {
    name: "send_message",
    description: "Send a proactive message to the user via Telegram.",
    input_schema: {
      type: "object" as const,
      properties: {
        text: {
          type: "string",
          description: "The message text to send",
        },
      },
      required: ["text"],
    },
  },
  handle: async (input: Record<string, unknown>) => {
    const messageText = input.text as string;
    const chatId = await getOwnerChatId();

    if (!chatId) {
      warn("telegram", "No owner chat ID known yet", { messageText });
      return { content: "Cannot send — no Telegram chat established yet." };
    }

    await sendTelegramMessage(chatId, messageText);
    return { content: "Message sent." };
  },
};

async function getOwnerChatId(): Promise<number | null> {
  const rows = await db`
    SELECT value FROM preferences WHERE key = 'telegram_chat_id' LIMIT 1
  `;
  if (rows.length === 0) return null;
  return rows[0].value as number;
}
