import assert from "node:assert/strict";
import { eventToolResult } from "@/events/eventToolResult.ts";

Deno.test("eventToolResult makes failed writes explicit", () => {
  const result = eventToolResult({
    operation: "drop",
    changed: false,
    eventId: "event-1",
    reason: "no_active_event",
  });

  assert.equal(result.isError, true);
  assert.deepEqual(JSON.parse(result.content), {
    operation: "drop",
    changed: false,
    eventId: "event-1",
    reason: "no_active_event",
  });
});

Deno.test("eventToolResult makes successful writes explicit", () => {
  const result = eventToolResult({
    operation: "drop",
    changed: true,
    eventId: "event-1",
    status: "dropped",
  });

  assert.equal(result.isError, false);
  assert.deepEqual(JSON.parse(result.content), {
    operation: "drop",
    changed: true,
    eventId: "event-1",
    status: "dropped",
  });
});
