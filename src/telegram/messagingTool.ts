import * as v from "valibot";
import type { ToolDefinition } from "@/tools/toolTypes.ts";
import { parseToolInput } from "@/tools/parseToolInput.ts";
import { sendTelegramMessage } from "@/telegram/sendTelegramMessage.ts";
import { resolveChatId } from "@/telegram/resolveChatId.ts";
import { warn } from "@/logger.ts";

const messagingInputSchema = v.object({
  text: v.pipe(v.string(), v.trim(), v.nonEmpty()),
  chat: v.optional(v.string()),
});

export const messagingTool: ToolDefinition = {
  schema: {
    name: "send_message",
    description: "Send a proactive message to the user via Telegram. Defaults to the owner's private chat. Pass 'chat' to target a specific group by name.",
    inputSchema: {
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

    const chatId = await resolveChatId(parsed.data.chat);

    if (!chatId) {
      const target = parsed.data.chat ?? "private";
      warn("telegram", "No chat found for send_message", { target });
      return { content: `Cannot send — no chat found matching "${target}".` };
    }

    await sendTelegramMessage(chatId, parsed.data.text);
    return { content: "Message sent." };
  },
};
