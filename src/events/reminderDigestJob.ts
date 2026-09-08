import { db } from "@/db.ts";
import { EventQueue } from "@/engine/eventQueue.ts";
import { getPrivateChat } from "@/telegram/chatRegistry.ts";

interface DigestItem {
  id: string;
  title: string;
  priority: string;
  due_at: Date;
  state: "upcoming" | "unresolved";
}

export async function reminderDigestJob(
  _jobName: string,
  queue?: EventQueue,
): Promise<Record<string, unknown>> {
  if (!queue) return { skipped: "event_queue_unavailable" };
  const chat = await getPrivateChat();
  if (!chat) return { skipped: "no_private_chat" };

  const items = await loadDigestItems();
  if (items.length === 0) return { queued: false, items: 0 };

  queue.push({
    id: crypto.randomUUID(),
    type: "scheduled",
    priority: "normal",
    payload: {
      text: digestPrompt(items),
      chat_id: chat.telegram_chat_id,
      internal_chat_id: chat.id,
      chat_type: chat.type,
      respond: true,
    },
    createdAt: new Date(),
  });
  return { queued: true, items: items.length };
}

async function loadDigestItems(): Promise<DigestItem[]> {
  return await db`
    SELECT DISTINCT ON (id) id, title, priority, due_at, state
    FROM (
      SELECT e.id, e.title, e.priority, o.due_at,
        CASE WHEN o.due_at < now() THEN 'unresolved' ELSE 'upcoming' END AS state
      FROM event_occurrences o
      JOIN events e ON e.id = o.event_id
      WHERE e.status = 'active'
        AND o.status IN ('pending', 'unresolved')
        AND (
          (o.due_at >= now() AND o.due_at < now() + interval '7 days')
          OR (e.priority = 'medium' AND o.due_at < now())
        )
      UNION ALL
      SELECT e.id, e.title, e.priority, e.next_due_at AS due_at, 'upcoming' AS state
      FROM events e
      WHERE e.status = 'active'
        AND e.next_due_at >= now()
        AND e.next_due_at < now() + interval '7 days'
    ) digest_items
    ORDER BY id, CASE WHEN state = 'unresolved' THEN 0 ELSE 1 END, due_at
  ` as unknown as DigestItem[];
}

function digestPrompt(items: DigestItem[]): string {
  const data = items.map((item) => ({
    event_id: item.id,
    title: item.title,
    priority: item.priority,
    due_at: item.due_at.toISOString(),
    state: item.state,
  }));
  return `[SCHEDULED REMINDER DIGEST]\nWrite the user's concise 8:00 AM reminder digest. ` +
    `Include every supplied item exactly once, put unresolved items first, then upcoming items by day. ` +
    `Use natural language and do not call tools or invent details. The look-ahead window is seven days.\n\n` +
    JSON.stringify(data);
}
