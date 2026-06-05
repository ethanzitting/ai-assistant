import type { QueueEvent } from "@/engine/eventQueue.ts";
import { persistMessage } from "@/conversationHistory.ts";

export async function persistDrainedMessages(
  events: QueueEvent[],
  traceId: string,
): Promise<void> {
  for (const event of events) {
    const payload = event.payload as Record<string, unknown>;
    const text = (payload.text as string) ?? JSON.stringify(payload);
    const internalChatId = payload.internal_chat_id as string | undefined;

    await persistMessage({
      role: "user",
      content: text,
      chatId: internalChatId,
      traceId,
    });
  }
}
