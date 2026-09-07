import type { ModelMessage, ToolSet } from "ai";
import {
  generateModelResponse,
  type ModelResult,
} from "@/ai/generateModelResponse.ts";
import { getAssistantMessage } from "@/ai/getAssistantMessage.ts";
import { toTraceTokenUsage } from "@/ai/toTraceTokenUsage.ts";
import { persistMessage } from "@/conversationHistory.ts";
import type { EventQueue, QueueEvent } from "@/engine/eventQueue.ts";
import { executeAllToolCalls } from "@/engine/executeAllToolCalls.ts";
import { appendToolResults } from "@/engine/appendToolResults.ts";
import { deliverFinalResponse } from "@/engine/deliverFinalResponse.ts";
import { persistDrainedMessages } from "@/engine/persistDrainedMessages.ts";
import { warn } from "@/logger.ts";
import { trace } from "@/trace.ts";

interface HandleToolUseOptions {
  initialResponse: ModelResult;
  messages: ModelMessage[];
  systemPrompt: string;
  tools: ToolSet;
  queue: EventQueue;
  telegramChatId: number | null;
  internalChatId?: string;
  respond: boolean;
  traceId: string;
  stopTyping: () => void;
}

export async function handleToolUseResponse(
  options: HandleToolUseOptions,
): Promise<void> {
  const {
    initialResponse,
    messages,
    systemPrompt,
    tools,
    queue,
    telegramChatId,
    internalChatId,
    respond,
    traceId,
    stopTyping,
  } = options;
  const MAX_TOOL_ITERATIONS = 50;
  let currentResponse = initialResponse;
  let iteration = 0;
  let hitMaxIterations = false;

  while (currentResponse.toolCalls.length > 0) {
    if (++iteration > MAX_TOOL_ITERATIONS) {
      hitMaxIterations = true;
      warn("tool-loop", "Hit max iterations", { max: MAX_TOOL_ITERATIONS });
      await trace(traceId, "tool-loop.max_iterations", {
        iteration,
        max: MAX_TOOL_ITERATIONS,
      });
      break;
    }

    const toolResults = await executeAllToolCalls(
      currentResponse,
      traceId,
      telegramChatId,
    );
    const { interruptText, drainedEvents } = drainHighPriorityContext(
      queue,
      internalChatId,
    );
    await persistDrainedMessages(drainedEvents, traceId);
    await persistToolCallRecord(currentResponse, internalChatId, traceId);
    appendToolResults({
      messages,
      assistantMessage: getAssistantMessage(currentResponse),
      toolResults,
      interruptText,
    });

    await trace(traceId, "model.request", {
      iteration,
      messageCount: messages.length,
    });

    const nextResponse = await generateModelResponse({
      systemPrompt,
      messages,
      tools,
    });

    await trace(traceId, "model.response", {
      ...toTraceTokenUsage(nextResponse.usage),
      stopReason: nextResponse.finishReason,
      rawStopReason: nextResponse.rawFinishReason,
      iteration,
    });
    await trace(traceId, "model.response.body", {
      iteration,
      content: getAssistantMessage(nextResponse).content,
    });

    const intermediateText = nextResponse.text;
    if (intermediateText.trim()) {
      await trace(traceId, "assistant.intermediate", {
        iteration,
        text: intermediateText,
      });
    }

    currentResponse = nextResponse;
  }

  stopTyping();
  await deliverFinalResponse(
    currentResponse,
    hitMaxIterations,
    telegramChatId,
    internalChatId,
    respond,
    traceId,
  );
}

interface DrainResult {
  interruptText: string | null;
  drainedEvents: QueueEvent[];
}

function drainHighPriorityContext(
  queue: EventQueue,
  currentChatId?: string,
): DrainResult {
  const highPriorityEvents = queue.drainHighPriority();
  if (highPriorityEvents.length === 0) {
    return { interruptText: null, drainedEvents: [] };
  }

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

  if (drainedEvents.length === 0) {
    return { interruptText: null, drainedEvents: [] };
  }

  const interruptText = drainedEvents
    .map((event) => {
      const payload = event.payload as Record<string, unknown>;
      return (payload.text as string) ?? JSON.stringify(payload);
    })
    .join("\n");

  return { interruptText, drainedEvents };
}

async function persistToolCallRecord(
  response: ModelResult,
  chatId: string | undefined,
  traceId: string,
): Promise<void> {
  const summary = response.toolCalls.map((call) => `[called ${call.toolName}]`)
    .join(" ");
  await persistMessage({
    role: "tool_call",
    content: summary,
    chatId,
    traceId,
  });
}
