import type { LanguageModelUsage, ModelMessage } from "ai";
import { generateModelResponse } from "@/ai/generateModelResponse.ts";
import { getAssistantMessage } from "@/ai/getAssistantMessage.ts";
import { toTraceTokenUsage } from "@/ai/toTraceTokenUsage.ts";
import { getToolSchemas } from "@/tools/toolRegistry.ts";
import { persistMessage } from "@/conversationHistory.ts";
import { assembleContext } from "@/prompt/assembleContext.ts";
import { EventQueue, type QueueEvent } from "@/engine/eventQueue.ts";
import { handleToolUseResponse } from "@/engine/handleToolUseResponse.ts";
import { sendTelegramMessage } from "@/telegram/sendTelegramMessage.ts";
import { startTypingIndicator } from "@/telegram/sendTypingIndicator.ts";
import { advanceWatermark } from "@/telegram/chatRegistry.ts";
import { clearPendingFlush } from "@/telegram/createTelegramBot.ts";
import { prefetchContext } from "@/knowledge/prefetchContext.ts";
import { debug, info, warn } from "@/logger.ts";
import { trace } from "@/trace.ts";

export async function processEvent(
  event: QueueEvent,
  queue: EventQueue,
): Promise<void> {
  const traceId = event.id;
  const payload = event.payload as Record<string, unknown>;
  const userMessage = (payload.text as string) ?? JSON.stringify(payload);
  const telegramChatId = (payload.chat_id as number) ?? null;
  const internalChatId = (payload.internal_chat_id as string) ?? undefined;
  const chatType = (payload.chat_type as string) ?? undefined;
  const respond = (payload.respond as boolean) ?? true;
  const metadata = extractMetadata(payload);

  await trace(traceId, "event.received", {
    type: event.type,
    priority: event.priority,
  });
  await trace(traceId, "user.message", {
    text: userMessage,
    chatId: telegramChatId,
    respond,
  });

  if (respond) {
    await persistMessage({
      role: "user",
      content: userMessage,
      chatId: internalChatId,
      metadata,
      traceId,
    });
  }

  const { systemPrompt, messages } = await assembleContext(
    internalChatId,
    chatType,
  );

  if (!respond) {
    ensureEndsWithUser(messages, userMessage);
  }

  const prefetchSummary = await prefetchContext(userMessage);
  if (prefetchSummary) {
    appendToLastUserMessage(messages, prefetchSummary);
  }

  await trace(traceId, "context.assembled", {
    messageCount: messages.length,
    systemPromptLength: systemPrompt.length,
    systemPrompt,
    messages,
  });

  const tools = getToolSchemas();
  await trace(traceId, "model.request", {
    messageCount: messages.length,
    toolCount: Object.keys(tools).length,
  });

  const stopTyping = (respond && telegramChatId)
    ? startTypingIndicator(telegramChatId)
    : () => {};

  try {
    const response = await generateModelResponse({
      systemPrompt,
      messages,
      tools,
    });

    logTokenUsage(response.usage);
    await trace(traceId, "model.response", {
      ...toTraceTokenUsage(response.usage),
      stopReason: response.finishReason,
      rawStopReason: response.rawFinishReason,
    });
    await trace(traceId, "model.response.body", {
      iteration: 0,
      content: getAssistantMessage(response).content,
    });

    if (response.toolCalls.length > 0) {
      await handleToolUseResponse({
        initialResponse: response,
        messages,
        systemPrompt,
        tools,
        queue,
        telegramChatId,
        internalChatId,
        respond,
        traceId,
        stopTyping,
      });
      return;
    }

    const assistantText = response.text;
    if (!assistantText.trim()) {
      warn("event", "Empty assistant response, skipping delivery");
      await trace(traceId, "response.empty", {
        stopReason: response.finishReason,
      });
      return;
    }
    await persistMessage({
      role: "assistant",
      content: assistantText,
      chatId: internalChatId,
      traceId,
    });

    stopTyping();
    if (respond) {
      await deliverResponse(assistantText, telegramChatId, traceId);
    } else {
      await trace(traceId, "response.suppressed", { text: assistantText });
    }
  } finally {
    stopTyping();
    if (!respond && internalChatId) {
      await advanceWatermark(internalChatId, new Date());
      clearPendingFlush(internalChatId);
      await trace(traceId, "flush.completed", { internalChatId });
    }
  }
}

function extractMetadata(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return (payload.audio_metadata as Record<string, unknown>) ??
    (payload.image_metadata as Record<string, unknown>) ??
    (payload.document_metadata as Record<string, unknown>) ??
    {};
}

async function deliverResponse(
  text: string,
  chatId: number | null,
  traceId: string,
): Promise<void> {
  info("assistant", text);
  if (chatId) await sendTelegramMessage(chatId, text);
  await trace(traceId, "response.delivered", {
    channel: chatId ? "telegram" : "none",
    chatId,
    text,
  });
}

function ensureEndsWithUser(
  messages: ModelMessage[],
  userMessage: string,
): void {
  const last = messages[messages.length - 1];
  if (!last || last.role === "user") return;
  messages.push({ role: "user", content: userMessage });
}

function appendToLastUserMessage(messages: ModelMessage[], text: string): void {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return;
  if (typeof last.content === "string") {
    last.content = `${last.content}\n\n${text}`;
  }
}

function logTokenUsage(usage: LanguageModelUsage): void {
  debug("tokens", "Usage", {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheCreation: usage.inputTokenDetails.cacheWriteTokens,
    cacheRead: usage.inputTokenDetails.cacheReadTokens,
  });
}
