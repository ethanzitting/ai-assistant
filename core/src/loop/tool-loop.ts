import type { MessageParam, Message, Tool } from "@/anthropic/mod.ts";
import { sendMessage } from "@/anthropic/mod.ts";
import { executeTool } from "@/tools/registry.ts";
import { persistMessage } from "@/context/conversation.ts";
import { assembleContext } from "@/context/assemble.ts";
import type { EventQueue } from "@/queue.ts";
import { extractTextContent, getToolUseBlocks } from "@/loop/content-helpers.ts";

export async function handleToolUseResponse(
  initialResponse: Message,
  systemPrompt: string,
  tools: Tool[],
  queue: EventQueue,
): Promise<void> {
  let currentResponse = initialResponse;

  while (currentResponse.stop_reason === "tool_use") {
    const toolResults = await executeAllToolCalls(currentResponse);
    const interruptContext = drainHighPriorityContext(queue);

    await persistToolCallRecord(currentResponse);

    const { messages } = await assembleContext();
    appendToolResults(messages, currentResponse, toolResults, interruptContext);

    const { response: nextResponse } = await sendMessage({
      systemPrompt,
      messages,
      tools,
    });

    currentResponse = nextResponse;
  }

  const finalText = extractTextContent(currentResponse);
  await persistMessage("assistant", finalText);
  console.log(`[assistant] ${finalText}`);
}

interface ToolCallResult {
  toolUseId: string;
  content: string;
  isError: boolean;
}

async function executeAllToolCalls(response: Message): Promise<ToolCallResult[]> {
  const toolBlocks = getToolUseBlocks(response);
  const results: ToolCallResult[] = [];

  for (const block of toolBlocks) {
    console.log(`[tool] ${block.name}(${JSON.stringify(block.input)})`);
    const result = await executeTool(block.name, block.input);
    console.log(`[tool result] ${result.content.substring(0, 200)}`);

    results.push({
      toolUseId: block.id,
      content: result.content,
      isError: result.isError ?? false,
    });
  }

  return results;
}

function appendToolResults(
  messages: MessageParam[],
  assistantResponse: Message,
  toolResults: ToolCallResult[],
  interruptContext: string | null,
): void {
  messages.push({ role: "assistant", content: assistantResponse.content });

  const resultBlocks = toolResults.map((result) => ({
    type: "tool_result" as const,
    tool_use_id: result.toolUseId,
    content: result.content,
  }));

  if (interruptContext && resultBlocks.length > 0) {
    const lastBlock = resultBlocks[resultBlocks.length - 1];
    lastBlock.content += `\n\n[While you were working, new events arrived: ${interruptContext}]`;
  }

  messages.push({ role: "user", content: resultBlocks });
}

function drainHighPriorityContext(queue: EventQueue): string | null {
  const highPriorityEvents = queue.drainHighPriority();
  if (highPriorityEvents.length === 0) return null;

  return highPriorityEvents
    .map((event) => {
      const payload = event.payload as Record<string, unknown>;
      return payload.text ?? JSON.stringify(payload);
    })
    .join("\n");
}

async function persistToolCallRecord(response: Message): Promise<void> {
  const toolBlocks = getToolUseBlocks(response);
  const summary = toolBlocks.map((block) => `[called ${block.name}]`).join(" ");
  await persistMessage("tool_call", summary);
}
