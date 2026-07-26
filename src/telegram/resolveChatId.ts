import { db } from "@/db.ts";
import { getPrivateChat } from "@/telegram/chatRegistry.ts";

export async function resolveChatId(chatName?: string): Promise<number | null> {
  if (!chatName) {
    const chat = await getPrivateChat();
    return chat ? chat.telegram_chat_id : null;
  }

  const rows = await db`
    SELECT telegram_chat_id FROM chats
    WHERE LOWER(name) = LOWER(${chatName})
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return rows[0].telegram_chat_id as number;
}
