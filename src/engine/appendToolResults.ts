import type { MessageParam, Message } from "@anthropic-ai/sdk/resources/messages.mjs";
import type { ToolCallResult } from "@/engine/executeAllToolCalls.ts";

interface AppendToolResultsOptions {
  messages: MessageParam[];
  assistantResponse: Message;
  toolResults: ToolCallResult[];
  interruptText: string | null;
}

export function appendToolResults(options: AppendToolResultsOptions): void {
  const { messages, assistantResponse, toolResults, interruptText } = options;

  messages.push({ role: "assistant", content: assistantResponse.content });

  const resultBlocks = toolResults.map((result) => ({
    type: "tool_result" as const,
    tool_use_id: result.toolUseId,
    content: result.content,
  }));

  if (interruptText && resultBlocks.length > 0) {
    const lastBlock = resultBlocks[resultBlocks.length - 1];
    lastBlock.content += `\n\n[While you were working, new events arrived: ${interruptText}]`;
  }

  messages.push({ role: "user", content: resultBlocks });
}
