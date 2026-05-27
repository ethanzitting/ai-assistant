import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { EventQueue } from "@/eventQueue.ts";

function makeEvent(
  priority: "high" | "normal",
  text: string,
  ageMs = 0,
): { id: string; type: "user_message"; priority: "high" | "normal"; payload: { text: string }; createdAt: Date } {
  return {
    id: crypto.randomUUID(),
    type: "user_message",
    priority,
    payload: { text },
    createdAt: new Date(Date.now() - ageMs),
  };
}

Deno.test("EventQueue processes high priority before normal", () => {
  const queue = new EventQueue();

  queue.push(makeEvent("normal", "low priority"));
  queue.push(makeEvent("high", "high priority"));

  const first = queue.shift()!;
  assertEquals((first.payload as { text: string }).text, "high priority");
});

Deno.test("EventQueue processes same-priority events in FIFO order", () => {
  const queue = new EventQueue();

  queue.push(makeEvent("normal", "first", 2000));
  queue.push(makeEvent("normal", "second", 1000));
  queue.push(makeEvent("normal", "third", 0));

  const first = queue.shift()!;
  assertEquals((first.payload as { text: string }).text, "first");
});

Deno.test("drainHighPriority returns only high-priority events", () => {
  const queue = new EventQueue();

  queue.push(makeEvent("normal", "stays"));
  queue.push(makeEvent("high", "drained"));
  queue.push(makeEvent("normal", "also stays"));

  const drained = queue.drainHighPriority();
  assertEquals(drained.length, 1);
  assertEquals((drained[0].payload as { text: string }).text, "drained");
  assertEquals(queue.length, 2);
});

Deno.test("waitForEvent resolves immediately when events exist", async () => {
  const queue = new EventQueue();
  queue.push(makeEvent("normal", "existing"));

  await queue.waitForEvent();
  assertEquals(queue.length, 1);
});

Deno.test("waitForEvent resolves when event is pushed", async () => {
  const queue = new EventQueue();

  const waitPromise = queue.waitForEvent();

  setTimeout(() => queue.push(makeEvent("normal", "delayed")), 10);

  await waitPromise;
  assertEquals(queue.length, 1);
});
