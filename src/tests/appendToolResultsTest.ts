import assert from "node:assert/strict";
import type { AssistantModelMessage, ModelMessage } from "ai";
import { appendToolResults } from "@/engine/appendToolResults.ts";

Deno.test("appendToolResults creates AI SDK assistant and tool messages", () => {
  const messages: ModelMessage[] = [];
  const assistantMessage: AssistantModelMessage = {
    role: "assistant",
    content: [{
      type: "tool-call",
      toolCallId: "call-1",
      toolName: "query_knowledge",
      input: { query: "test" },
    }],
  };

  appendToolResults({
    messages,
    assistantMessage,
    toolResults: [{
      toolUseId: "call-1",
      toolName: "query_knowledge",
      content: "result",
      isError: false,
    }],
    interruptText: "one more thing",
  });

  assert.deepEqual(messages[0], assistantMessage);
  assert.deepEqual(messages[1], {
    role: "tool",
    content: [{
      type: "tool-result",
      toolCallId: "call-1",
      toolName: "query_knowledge",
      output: {
        type: "text",
        value: "result",
      },
    }],
  });
  assert.deepEqual(messages[2], {
    role: "user",
    content: "[New message from user: one more thing]",
  });
});

Deno.test("appendToolResults retains every sequential tool round", () => {
  const messages: ModelMessage[] = [];

  for (const round of [1, 2]) {
    appendToolResults({
      messages,
      assistantMessage: {
        role: "assistant",
        content: [{
          type: "tool-call",
          toolCallId: `call-${round}`,
          toolName: "query_knowledge",
          input: { query: `query ${round}` },
        }],
      },
      toolResults: [{
        toolUseId: `call-${round}`,
        toolName: "query_knowledge",
        content: `result ${round}`,
        isError: false,
      }],
      interruptText: null,
    });
  }

  assert.equal(messages.length, 4);
  assert.equal(messages[1].role, "tool");
  assert.equal(messages[3].role, "tool");
  const firstResult = messages[1];
  if (firstResult.role !== "tool") throw new Error("Expected tool message");
  const firstResultPart = firstResult.content[0];
  if (firstResultPart.type !== "tool-result") {
    throw new Error("Expected tool result");
  }
  assert.deepEqual(firstResultPart.output, {
    type: "text",
    value: "result 1",
  });
});
