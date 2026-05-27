import { EventQueue } from "@/eventQueue.ts";
import { processEvent } from "@/engine/processEvent.ts";

export async function runEventLoop(queue: EventQueue): Promise<void> {
  console.log("Event loop started. Waiting for events...");

  while (true) {
    await queue.waitForEvent();

    const event = queue.shift();
    if (!event) continue;

    console.log(`[event] Processing ${event.type} (priority: ${event.priority})`);

    try {
      await processEvent(event, queue);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[event] Failed to process ${event.type}: ${errorMessage}`);
    }
  }
}
