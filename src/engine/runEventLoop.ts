import { EventQueue, type QueueEvent } from "@/engine/eventQueue.ts";
import { processEvent } from "@/engine/processEvent.ts";
import { sendTelegramMessage } from "@/telegram/sendTelegramMessage.ts";
import { info, error, warn } from "@/logger.ts";

export async function runEventLoop(queue: EventQueue): Promise<void> {
  info("event", "Event loop started");

  while (true) {
    await queue.waitForEvent();

    const event = queue.shift();
    if (!event) continue;

    info("event", "Processing", { type: event.type, priority: event.priority });

    try {
      await processEvent(event, queue);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      error("event", "Failed to process", { type: event.type, error: errorMessage });
      await notifyUserOfFailure(event);
    }
  }
}

async function notifyUserOfFailure(event: QueueEvent): Promise<void> {
  // Assumes a user-initiated turn ("mind trying again?"). When the event scheduler
  // is wired up, system-fired events (reminders, daily briefing) will need different
  // wording — they aren't something the user can retry.
  const chatId = (event.payload as Record<string, unknown>).chat_id as number | undefined;
  if (!chatId) return;

  try {
    await sendTelegramMessage(
      chatId,
      "⚠️ Something went wrong on my end while processing that — it didn't go through. The error's been logged. Mind trying again?",
    );
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    warn("event", "Failed to notify user of processing failure", { error: errorMessage });
  }
}
