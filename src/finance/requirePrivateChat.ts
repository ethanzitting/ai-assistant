import { getPrivateChat } from "@/telegram/chatRegistry.ts";
import type { ToolResult } from "@/tools/toolTypes.ts";
import { warn } from "@/logger.ts";

// Balances and spending history go to the owner's private chat and nowhere else. Jarvis sits in
// group chats, and the group addendum in the system prompt tells it to share freely there — so
// without this, one casual question would put account balances in front of everyone in the room.
// Deny by default: an unknown chat is not the private chat.
export async function requirePrivateChat(
  telegramChatId?: number | null,
): Promise<ToolResult | null> {
  const privateChat = await getPrivateChat();

  if (!privateChat) {
    warn("finance", "No private chat registered, refusing finance tool");
    return {
      content: "No private chat is registered, so financial data cannot be shared.",
      isError: true,
    };
  }

  if (telegramChatId === privateChat.telegram_chat_id) return null;

  warn("finance", "Blocked finance tool outside the private chat", { telegramChatId });
  return {
    content:
      "Financial data is only available in Ethan's private chat. Say so plainly and do not " +
      "describe, summarise, or estimate any spending or balance figures here.",
    isError: true,
  };
}
