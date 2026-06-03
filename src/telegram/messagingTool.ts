import * as v from "valibot";
import type { ToolDefinition } from "@/tools/toolTypes.ts";
import { parseToolInput } from "@/tools/parseToolInput.ts";
import { sendTelegramMessage } from "@/telegram/sendTelegramMessage.ts";
import { getPrivateChat } from "@/telegram/chatRegistry.ts";
import { db } from "@/db.ts";
import { warn } from "@/logger.ts";

const messagingInputSchema = v.object({
  text: v.pipe(v.string(), v.trim(), v.nonEmpty()),
  chat: v.optional(v.string()),
});

export const messagingTool: ToolDefinition = {
  schema: {
    name: "send_message",
    description: "Send a proactive message to the user via Telegram. Defaults to the owner's private chat. Pass 'chat' to target a specific group by name.",
    input_schema: {
      type: "object" as const,
      properties: {
        text: {
          type: "string",
          description: "The message text to send",
        },
        chat: {
          type: "string",
          description: "Target chat name (e.g. 'Dana Care'). Omit for private chat.",
        },
      },
      required: ["text"],
    },
  },
  handle: async (input: Record<string, unknown>) => {
    const parsed = parseToolInput(messagingInputSchema, input, '{ text: "message", chat?: "group name" }');
    if (!parsed.success) return parsed.error;

    const chatId = parsed.data.chat
      ? await resolveChatByName(parsed.data.chat)
      : await getOwnerChatId();

    if (!chatId) {
      const target = parsed.data.chat ?? "private";
      warn("telegram", "No chat found for send_message", { target });
      return { content: `Cannot send — no chat found matching "${target}".` };
    }

    await sendTelegramMessage(chatId, parsed.data.text);
    return { content: "Message sent." };
  },
};

async function getOwnerChatId(): Promise<number | null> {
  const chat = await getPrivateChat();
  if (chat) return chat.telegram_chat_id;

  const rows = await db`
    SELECT value FROM preferences WHERE key = 'telegram_chat_id' LIMIT 1
  `;
  if (rows.length === 0) return null;
  return rows[0].value as number;
}

async function resolveChatByName(name: string): Promise<number | null> {
  const rows = await db`
    SELECT telegram_chat_id FROM chats
    WHERE LOWER(name) = LOWER(${name})
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return rows[0].telegram_chat_id as number;
}
