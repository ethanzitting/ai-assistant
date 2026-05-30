import type { Message, ToolUnion } from "@anthropic-ai/sdk/resources/messages.mjs";
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
  tools: ToolUnion[];
  queue: EventQueue;
  chatId: number | null;
  traceId: string;
  stopTyping: () => void;
}

export async function handleToolUseResponse(options: HandleToolUseOptions): Promise<void> {
  const { initialResponse, systemPrompt, tools, queue, chatId, traceId, stopTyping } = options;
  const MAX_TOOL_ITERATIONS = 50;
  let currentResponse = initialResponse;
  let iteration = 0;

  while (currentResponse.stop_reason === "tool_use" || currentResponse.stop_reason === "pause_turn") {
    if (++iteration > MAX_TOOL_ITERATIONS) {
      warn("tool-loop", "Hit max iterations", { max: MAX_TOOL_ITERATIONS });
      await trace(traceId, "tool-loop.max_iterations", { iteration, max: MAX_TOOL_ITERATIONS });
      break;
    }

    const { messages } = await assembleContext();

    if (currentResponse.stop_reason === "pause_turn") {
      await trace(traceId, "server_tool.pause_turn", { iteration });
      messages.push({ role: "assistant", content: currentResponse.content });
    } else {
      const toolResults = await executeAllToolCalls(currentResponse, traceId);
      const interruptText = drainHighPriorityContext(queue);
      await persistToolCallRecord(currentResponse, traceId);
      appendToolResults({ messages, assistantResponse: currentResponse, toolResults, interruptText });
    }

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
    await trace(traceId, "claude.response.body", {
      iteration,
      content: nextResponse.content,
    });

    const intermediateText = extractTextContent(nextResponse);
    if (intermediateText.trim()) {
      await trace(traceId, "assistant.intermediate", { iteration, text: intermediateText });
    }

    currentResponse = nextResponse;
  }

  const finalText = extractTextContent(currentResponse);
  await persistMessage({ role: "assistant", content: finalText, traceId });
  info("assistant", finalText);
  stopTyping();
  if (chatId) await sendTelegramMessage(chatId, finalText);
  await trace(traceId, "response.delivered", {
    channel: chatId ? "telegram" : "none",
    chatId,
    text: finalText,
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
