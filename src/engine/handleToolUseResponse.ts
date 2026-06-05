import type { Message, ToolUnion } from "@anthropic-ai/sdk/resources/messages.mjs";
import { sendMessage } from "@/anthropic/sendMessage.ts";
import { persistMessage } from "@/conversationHistory.ts";
import { assembleContext } from "@/prompt/assembleContext.ts";
import type { EventQueue, QueueEvent } from "@/engine/eventQueue.ts";
import { extractTextContent, getToolUseBlocks } from "@/engine/parseResponse.ts";
import { executeAllToolCalls } from "@/engine/executeAllToolCalls.ts";
import { appendToolResults } from "@/engine/appendToolResults.ts";
import { deliverFinalResponse } from "@/engine/deliverFinalResponse.ts";
import { persistDrainedMessages } from "@/engine/persistDrainedMessages.ts";
import { warn } from "@/logger.ts";
import { trace } from "@/trace.ts";

interface HandleToolUseOptions {
  initialResponse: Message;
  systemPrompt: string;
  tools: ToolUnion[];
  queue: EventQueue;
  telegramChatId: number | null;
  internalChatId?: string;
  respond: boolean;
  traceId: string;
  stopTyping: () => void;
}

export async function handleToolUseResponse(options: HandleToolUseOptions): Promise<void> {
  const {
    initialResponse, systemPrompt, tools, queue,
    telegramChatId, internalChatId, respond, traceId, stopTyping,
  } = options;
  const MAX_TOOL_ITERATIONS = 50;
  let currentResponse = initialResponse;
  let iteration = 0;
  let hitMaxIterations = false;

  while (currentResponse.stop_reason === "tool_use" || currentResponse.stop_reason === "pause_turn") {
    if (++iteration > MAX_TOOL_ITERATIONS) {
      hitMaxIterations = true;
      warn("tool-loop", "Hit max iterations", { max: MAX_TOOL_ITERATIONS });
      await trace(traceId, "tool-loop.max_iterations", { iteration, max: MAX_TOOL_ITERATIONS });
      break;
    }

    const { messages } = await assembleContext(internalChatId);

    if (currentResponse.stop_reason === "pause_turn") {
      await trace(traceId, "server_tool.pause_turn", { iteration });
      messages.push({ role: "assistant", content: currentResponse.content });
    } else {
      const toolResults = await executeAllToolCalls(currentResponse, traceId);
      const { interruptText, drainedEvents } = drainHighPriorityContext(queue, internalChatId);
      await persistDrainedMessages(drainedEvents, traceId);
      await persistToolCallRecord(currentResponse, internalChatId, traceId);
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

  stopTyping();
  await deliverFinalResponse(currentResponse, hitMaxIterations, telegramChatId, internalChatId, respond, traceId);
}

interface DrainResult {
  interruptText: string | null;
  drainedEvents: QueueEvent[];
}

function drainHighPriorityContext(queue: EventQueue, currentChatId?: string): DrainResult {
  const highPriorityEvents = queue.drainHighPriority();
  if (highPriorityEvents.length === 0) return { interruptText: null, drainedEvents: [] };

  const drainedEvents: QueueEvent[] = [];
  const returned: QueueEvent[] = [];

  for (const event of highPriorityEvents) {
    const payload = event.payload as Record<string, unknown>;
    const eventChatId = payload.internal_chat_id as string | undefined;

    if (!currentChatId || eventChatId === currentChatId || !eventChatId) {
      drainedEvents.push(event);
    } else {
      returned.push(event);
    }
  }

  for (const event of returned) {
    queue.push(event);
  }

  if (drainedEvents.length === 0) return { interruptText: null, drainedEvents: [] };

  const interruptText = drainedEvents
    .map((event) => {
      const payload = event.payload as Record<string, unknown>;
      return (payload.text as string) ?? JSON.stringify(payload);
    })
    .join("\n");

  return { interruptText, drainedEvents };
}

async function persistToolCallRecord(response: Message, chatId: string | undefined, traceId: string): Promise<void> {
  const toolBlocks = getToolUseBlocks(response);
  const summary = toolBlocks.map((block) => `[called ${block.name}]`).join(" ");
  await persistMessage({ role: "tool_call", content: summary, chatId, traceId });
}
