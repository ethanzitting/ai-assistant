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
  metadata?: Record<string, unknown>;
  traceId?: string;
}

export async function persistMessage(options: PersistMessageOptions): Promise<void> {
  const { role, content, metadata = {}, traceId } = options;

  await db`
    INSERT INTO conversations (role, content, metadata)
    VALUES (${role}, ${content}, ${JSON.stringify(metadata)})
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
