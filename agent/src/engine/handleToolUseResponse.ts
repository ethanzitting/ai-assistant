import type { MessageParam, Message, Tool } from "@/anthropic/anthropicExports.ts";
import { sendMessage } from "@/anthropic/anthropicExports.ts";
import { executeTool } from "@/tools/toolRegistry.ts";
import { persistMessage } from "@/conversation/conversationHistory.ts";
import { assembleContext } from "@/prompt/assembleContext.ts";
import type { EventQueue } from "@/eventQueue.ts";
import { extractTextContent, getToolUseBlocks } from "@/engine/parseResponse.ts";
import { sendTelegramMessage } from "@/telegram/sendTelegramMessage.ts";

export async function handleToolUseResponse(
  initialResponse: Message,
  systemPrompt: string,
  tools: Tool[],
  queue: EventQueue,
  chatId: number | null = null,
): Promise<void> {
  const MAX_TOOL_ITERATIONS = 15;
  let currentResponse = initialResponse;
  let iteration = 0;

  while (currentResponse.stop_reason === "tool_use") {
    if (++iteration > MAX_TOOL_ITERATIONS) {
      console.warn(`[tool-loop] Hit max iterations (${MAX_TOOL_ITERATIONS}), forcing stop.`);
      break;
    }
    const toolResults = await executeAllToolCalls(currentResponse);
    const highPriorityInterruptText = drainHighPriorityContext(queue);

    await persistToolCallRecord(currentResponse);

    const { messages } = await assembleContext();
    appendToolResults(messages, currentResponse, toolResults, highPriorityInterruptText);

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
  if (chatId) await sendTelegramMessage(chatId, finalText);
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
  highPriorityInterruptText: string | null,
): void {
  messages.push({ role: "assistant", content: assistantResponse.content });

  const resultBlocks = toolResults.map((result) => ({
    type: "tool_result" as const,
    tool_use_id: result.toolUseId,
    content: result.content,
  }));

  if (highPriorityInterruptText && resultBlocks.length > 0) {
    const lastBlock = resultBlocks[resultBlocks.length - 1];
    lastBlock.content += `\n\n[While you were working, new events arrived: ${highPriorityInterruptText}]`;
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
