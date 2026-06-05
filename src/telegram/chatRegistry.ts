import { db } from "@/db.ts";

export interface ChatRow {
  id: string;
  telegram_chat_id: number;
  type: string;
  name: string | null;
  notified_at: Date | null;
  last_processed_at: Date | null;
}

interface ChatInfo {
  telegramChatId: number;
  type: string;
  name?: string;
}

export async function ensureChat(chatInfo: ChatInfo): Promise<ChatRow> {
  const rows = await db`
    INSERT INTO chats (telegram_chat_id, type, name)
    VALUES (${chatInfo.telegramChatId}, ${chatInfo.type}, ${chatInfo.name ?? null})
    ON CONFLICT (telegram_chat_id) DO UPDATE SET
      type = EXCLUDED.type,
      name = COALESCE(EXCLUDED.name, chats.name),
      updated_at = now()
    RETURNING *
  ` as unknown as ChatRow[];

  return rows[0];
}

export async function getPrivateChat(): Promise<ChatRow | null> {
  const rows = await db`
    SELECT * FROM chats WHERE type = 'private' ORDER BY created_at LIMIT 1
  ` as unknown as ChatRow[];

  return rows[0] ?? null;
}

export async function advanceWatermark(chatId: string, processedAt: Date): Promise<void> {
  await db`
    UPDATE chats
    SET last_processed_at = ${processedAt}, updated_at = now()
    WHERE id = ${chatId}
  `;
}

export async function getWatermark(chatId: string): Promise<Date | null> {
  const rows = await db`
    SELECT last_processed_at FROM chats WHERE id = ${chatId} LIMIT 1
  `;

  if (rows.length === 0) return null;
  return rows[0].last_processed_at as Date | null;
}

export async function markNotified(chatId: string): Promise<void> {
  await db`
    UPDATE chats SET notified_at = now(), updated_at = now() WHERE id = ${chatId}
  `;
}
