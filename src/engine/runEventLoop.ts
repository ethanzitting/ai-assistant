import { EventQueue } from "@/engine/eventQueue.ts";
import { processEvent } from "@/engine/processEvent.ts";
import { info, error } from "@/logger.ts";

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
    }
  }
}
