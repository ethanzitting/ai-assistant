import type { ToolDefinition } from "@/tools/types.ts";

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
    console.log(`[send_message] Would send: ${messageText}`);
    return {
      content: "Telegram is not yet configured (Phase 3). Message logged to console.",
    };
  },
};
