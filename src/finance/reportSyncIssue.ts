import { resolveChatId } from "@/telegram/resolveChatId.ts";
import { sendTelegramMessage } from "@/telegram/sendTelegramMessage.ts";
import { warn } from "@/logger.ts";

// Financial state goes to the owner's private chat and nowhere else, so this deliberately ignores
// any group chat the assistant belongs to.
export async function reportSyncIssue(message: string): Promise<void> {
  const chatId = await resolveChatId();
  if (!chatId) {
    warn("finance", "No private chat to report sync issue to", { message });
    return;
  }

  try {
    await sendTelegramMessage(chatId, message);
  } catch (err: unknown) {
    warn("finance", "Failed to send sync issue report", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
