import type { EventQueue } from "@/engine/eventQueue.ts";

const DEBOUNCE_MS = 1000;

interface TextMessagePayload {
  text: string;
  chat_id: number;
  internal_chat_id: string;
  chat_type: string;
  sender_name?: string;
  sender_id?: string;
  reply_to_message_id?: number;
  respond: boolean;
}

interface PendingBatch {
  timer: ReturnType<typeof setTimeout> | null;
  payloads: TextMessagePayload[];
}

const pending = new Map<string, PendingBatch>();

export function enqueueWithBatching(
  queue: EventQueue,
  payload: TextMessagePayload,
): void {
  const key = payload.internal_chat_id;
  const existing = pending.get(key);

  if (existing) {
    if (existing.timer) clearTimeout(existing.timer);
    existing.payloads.push(payload);
  } else {
    pending.set(key, { timer: null, payloads: [payload] });
  }

  const batch = pending.get(key)!;
  batch.timer = setTimeout(() => flush(queue, key), DEBOUNCE_MS);
}

function flush(queue: EventQueue, key: string): void {
  const batch = pending.get(key);
  if (!batch) return;
  pending.delete(key);

  const first = batch.payloads[0];
  const combinedText = batch.payloads.map((p) => p.text).join("\n");

  queue.push({
    id: crypto.randomUUID(),
    type: "user_message",
    priority: "high",
    payload: {
      text: combinedText,
      chat_id: first.chat_id,
      internal_chat_id: first.internal_chat_id,
      chat_type: first.chat_type,
      sender_name: first.sender_name,
      sender_id: first.sender_id,
      reply_to_message_id: batch.payloads.length === 1
        ? first.reply_to_message_id
        : undefined,
      respond: true,
    },
    createdAt: new Date(),
  });
}
