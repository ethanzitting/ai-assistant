import type { AssistantModelMessage, ModelMessage, ToolModelMessage } from "ai";
import type { ToolCallResult } from "@/engine/executeAllToolCalls.ts";

interface AppendToolResultsOptions {
  messages: ModelMessage[];
  assistantMessage: AssistantModelMessage;
  toolResults: ToolCallResult[];
  interruptText: string | null;
}

export function appendToolResults(options: AppendToolResultsOptions): void {
  const { messages, assistantMessage, toolResults, interruptText } = options;

  messages.push(assistantMessage);

  const resultBlocks = toolResults.map((result) => ({
    type: "tool-result" as const,
    toolCallId: result.toolUseId,
    toolName: result.toolName,
    output: result.isError
      ? { type: "error-text" as const, value: result.content }
      : { type: "text" as const, value: result.content },
  }));

  const toolMessage: ToolModelMessage = { role: "tool", content: resultBlocks };
  messages.push(toolMessage);
  if (interruptText) {
    messages.push({
      role: "user",
      content: `[New message from user: ${interruptText}]`,
    });
  }
}
