import { db } from "@/db.ts";
import { trace } from "@/trace.ts";

export interface ConversationRow {
  id: string;
  role: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: Date;
}

interface PersistMessageOptions {
  role: string;
  content: string;
  chatId?: string;
  metadata?: Record<string, unknown>;
  traceId?: string;
}

export async function persistMessage(options: PersistMessageOptions): Promise<void> {
  const { role, content, chatId, metadata = {}, traceId } = options;

  await db`
    INSERT INTO conversations (role, content, chat_id, metadata, trace_id)
    VALUES (${role}, ${content}, ${chatId ?? null}, ${db.json(metadata as never)}, ${traceId ?? null})
  `;

  if (traceId) {
    await trace(traceId, "db.insert", { table: "conversations", role, contentLength: content.length });
  }
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

export async function loadChatMessages(
  chatId: string,
  limit: number,
): Promise<ConversationRow[]> {
  return await db`
    SELECT id, role, content, metadata, created_at
    FROM conversations
    WHERE chat_id = ${chatId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  ` as unknown as ConversationRow[];
}

export async function loadMessagesSince(
  chatId: string,
  since: Date,
): Promise<ConversationRow[]> {
  return await db`
    SELECT id, role, content, metadata, created_at
    FROM conversations
    WHERE chat_id = ${chatId} AND created_at > ${since}
    ORDER BY created_at ASC
  ` as unknown as ConversationRow[];
}

export async function estimateBacklogTokens(
  chatId: string,
  since: Date | null,
): Promise<number> {
  const condition = since
    ? db`AND created_at > ${since}`
    : db``;

  const rows = await db`
    SELECT COALESCE(SUM(CEIL(char_length(content) / 4.0)), 0)::int AS tokens
    FROM conversations
    WHERE chat_id = ${chatId}
      AND role = 'context'
      ${condition}
  `;

  return rows[0].tokens as number;
}
