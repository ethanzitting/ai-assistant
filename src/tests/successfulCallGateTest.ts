import assert from "node:assert/strict";
import { createSuccessfulCallGate } from "@/tools/createSuccessfulCallGate.ts";

Deno.test("successful call gate blocks the fourth success", () => {
  const gate = createSuccessfulCallGate(3);

  assert.equal(gate.isBlocked("trace-a"), false);
  gate.recordSuccess("trace-a");
  assert.equal(gate.isBlocked("trace-a"), false);
  gate.recordSuccess("trace-a");
  assert.equal(gate.isBlocked("trace-a"), false);
  gate.recordSuccess("trace-a");
  assert.equal(gate.isBlocked("trace-a"), true);
});

Deno.test("successful call gate resets for a new trace", () => {
  const gate = createSuccessfulCallGate(1);

  gate.recordSuccess("trace-a");
  assert.equal(gate.isBlocked("trace-a"), true);
  assert.equal(gate.isBlocked("trace-b"), false);
});
