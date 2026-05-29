import type { Message, Tool } from "@anthropic-ai/sdk/resources/messages.mjs";
import { sendMessage } from "@/anthropic/sendMessage.ts";
import { persistMessage } from "@/conversationHistory.ts";
import { assembleContext } from "@/prompt/assembleContext.ts";
import type { EventQueue } from "@/engine/eventQueue.ts";
import { extractTextContent, getToolUseBlocks } from "@/engine/parseResponse.ts";
import { sendTelegramMessage } from "@/telegram/sendTelegramMessage.ts";
import { executeAllToolCalls } from "@/engine/executeAllToolCalls.ts";
import { appendToolResults } from "@/engine/appendToolResults.ts";
import { info, warn } from "@/logger.ts";
import { trace } from "@/trace.ts";

interface HandleToolUseOptions {
  initialResponse: Message;
  systemPrompt: string;
  tools: Tool[];
  queue: EventQueue;
  chatId: number | null;
  traceId: string;
}

export async function handleToolUseResponse(options: HandleToolUseOptions): Promise<void> {
  const { initialResponse, systemPrompt, tools, queue, chatId, traceId } = options;
  const MAX_TOOL_ITERATIONS = 15;
  let currentResponse = initialResponse;
  let iteration = 0;

  while (currentResponse.stop_reason === "tool_use") {
    if (++iteration > MAX_TOOL_ITERATIONS) {
      warn("tool-loop", "Hit max iterations", { max: MAX_TOOL_ITERATIONS });
      await trace(traceId, "tool-loop.max_iterations", { iteration, max: MAX_TOOL_ITERATIONS });
      break;
    }
    const toolResults = await executeAllToolCalls(currentResponse, traceId);
    const interruptText = drainHighPriorityContext(queue);

    await persistToolCallRecord(currentResponse, traceId);

    const { messages } = await assembleContext();
    appendToolResults({ messages, assistantResponse: currentResponse, toolResults, interruptText });

    await trace(traceId, "claude.request", { iteration, messageCount: messages.length });

    const { response: nextResponse, tokenUsage } = await sendMessage({
      systemPrompt,
      messages,
      tools,
    });

    await trace(traceId, "claude.response", {
      ...tokenUsage,
      stopReason: nextResponse.stop_reason,
      iteration,
    });

    currentResponse = nextResponse;
  }

  const finalText = extractTextContent(currentResponse);
  await persistMessage({ role: "assistant", content: finalText, traceId });
  info("assistant", finalText);
  if (chatId) await sendTelegramMessage(chatId, finalText);
  await trace(traceId, "response.delivered", {
    channel: chatId ? "telegram" : "none",
    chatId,
  });
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

async function persistToolCallRecord(response: Message, traceId: string): Promise<void> {
  const toolBlocks = getToolUseBlocks(response);
  const summary = toolBlocks.map((block) => `[called ${block.name}]`).join(" ");
  await persistMessage({ role: "tool_call", content: summary, traceId });
}
