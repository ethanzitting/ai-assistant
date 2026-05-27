import { db } from "@/db.ts";

export interface ConversationRow {
  id: string;
  role: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export async function persistMessage(
  role: string,
  content: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await db`
    INSERT INTO conversations (role, content, metadata)
    VALUES (${role}, ${content}, ${JSON.stringify(metadata)})
  `;
}

export async function loadRecentMessages(
  limit: number,
): Promise<ConversationRow[]> {
  return await db`
    SELECT id, role, content, metadata, created_at
    FROM conversations
    ORDER BY created_at DESC
    LIMIT ${limit}
  ` as unknown as ConversationRow[];
}
