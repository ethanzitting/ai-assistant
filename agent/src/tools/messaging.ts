import type { ToolDefinition } from "@/tools/types.ts";
import { sendTelegramMessage } from "@/telegram/send.ts";
import { db } from "@/db.ts";

export const sendMessage: ToolDefinition = {
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
  handle: async (input) => {
    const messageText = input.text as string;
    const chatId = await getOwnerChatId();

    if (!chatId) {
      console.log(`[send_message] No owner chat ID known yet. Message: ${messageText}`);
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
