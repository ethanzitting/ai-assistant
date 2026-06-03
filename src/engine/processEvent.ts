import { sendMessage, type TokenUsage } from "@/anthropic/sendMessage.ts";
import { getToolSchemas } from "@/tools/toolRegistry.ts";
import { persistMessage } from "@/conversationHistory.ts";
import { assembleContext } from "@/prompt/assembleContext.ts";
import { type QueueEvent, EventQueue } from "@/engine/eventQueue.ts";
import { handleToolUseResponse } from "@/engine/handleToolUseResponse.ts";
import { extractTextContent, hasToolUse } from "@/engine/parseResponse.ts";
import { sendTelegramMessage } from "@/telegram/sendTelegramMessage.ts";
import { startTypingIndicator } from "@/telegram/sendTypingIndicator.ts";
import { advanceWatermark } from "@/telegram/chatRegistry.ts";
import { clearPendingFlush } from "@/telegram/createTelegramBot.ts";
import { info, warn, debug } from "@/logger.ts";
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

  await trace(traceId, "event.received", { type: event.type, priority: event.priority });
  await trace(traceId, "user.message", { text: userMessage, chatId: telegramChatId, respond });

  if (respond) {
    await persistMessage({ role: "user", content: userMessage, chatId: internalChatId, metadata, traceId });
  }

  const { systemPrompt, messages } = await assembleContext(internalChatId, chatType);
  await trace(traceId, "context.assembled", {
    messageCount: messages.length,
    systemPromptLength: systemPrompt.length,
    systemPrompt,
    messages,
  });

  const tools = getToolSchemas();
  await trace(traceId, "claude.request", { messageCount: messages.length, toolCount: tools.length });

  const stopTyping = (respond && telegramChatId) ? startTypingIndicator(telegramChatId) : () => {};

  try {
    const { response, tokenUsage } = await sendMessage({
      systemPrompt,
      messages,
      tools,
    });

    logTokenUsage(tokenUsage);
    await trace(traceId, "claude.response", {
      ...tokenUsage,
      stopReason: response.stop_reason,
    });
    await trace(traceId, "claude.response.body", {
      iteration: 0,
      content: response.content,
    });

    if (hasToolUse(response)) {
      await handleToolUseResponse({
        initialResponse: response, systemPrompt, tools, queue,
        telegramChatId, internalChatId, respond, traceId, stopTyping,
      });
      return;
    }

    const assistantText = extractTextContent(response);
    if (!assistantText.trim()) {
      warn("event", "Empty assistant response, skipping delivery");
      await trace(traceId, "response.empty", { stopReason: response.stop_reason });
      return;
    }
    await persistMessage({ role: "assistant", content: assistantText, chatId: internalChatId, traceId });

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

function extractMetadata(payload: Record<string, unknown>): Record<string, unknown> {
  return (payload.audio_metadata as Record<string, unknown>)
    ?? (payload.image_metadata as Record<string, unknown>)
    ?? {};
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

function logTokenUsage(tokenUsage: TokenUsage): void {
  debug("tokens", "Usage", {
    inputTokens: tokenUsage.inputTokens,
    outputTokens: tokenUsage.outputTokens,
    cacheCreation: tokenUsage.cacheCreationTokens,
    cacheRead: tokenUsage.cacheReadTokens,
  });
}
