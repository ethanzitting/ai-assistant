import type { ToolResult } from "@/tools/toolTypes.ts";
import { warn } from "@/logger.ts";

// Balances and spending history go to the owner and nowhere else. Jarvis sits in group chats, and
// the group addendum tells it to share freely there — so without this, one casual question would
// put account balances in front of everyone in the room.
//
// Keyed on TELEGRAM_OWNER_ID rather than a chats row: for a private chat Telegram's chat id IS the
// user id, so this compares against the identity the bot's own access control uses instead of
// against "whichever private chat row is oldest". Deny by default.
export function requirePrivateChat(telegramChatId?: number | null): ToolResult | null {
  const ownerId = Deno.env.get("TELEGRAM_OWNER_ID");

  if (!ownerId) {
    warn("finance", "TELEGRAM_OWNER_ID is unset, refusing finance tool");
    return {
      content: "The owner is not configured, so financial data cannot be shared.",
      isError: true,
    };
  }

  if (telegramChatId !== undefined && telegramChatId !== null && String(telegramChatId) === ownerId) {
    return null;
  }

  warn("finance", "Blocked finance tool outside the owner's private chat", { telegramChatId });
  return {
    content:
      "Financial data is only available in Ethan's private chat. Say so plainly and do not " +
      "describe, summarise, or estimate any spending or balance figures here.",
    isError: true,
  };
}
