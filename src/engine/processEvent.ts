import { sendMessage, type TokenUsage } from "@/anthropic/sendMessage.ts";
import { getToolSchemas } from "@/tools/toolRegistry.ts";
import { persistMessage } from "@/conversationHistory.ts";
import { assembleContext } from "@/prompt/assembleContext.ts";
import { type QueueEvent, EventQueue } from "@/engine/eventQueue.ts";
import { handleToolUseResponse } from "@/engine/handleToolUseResponse.ts";
import { extractTextContent, hasToolUse } from "@/engine/parseResponse.ts";
import { sendTelegramMessage } from "@/telegram/sendTelegramMessage.ts";
import { info, warn, debug } from "@/logger.ts";
import { trace } from "@/trace.ts";

export async function processEvent(
  event: QueueEvent,
  queue: EventQueue,
): Promise<void> {
  const traceId = event.id;
  const userMessage = extractUserMessage(event);
  const chatId = extractChatId(event);
  const metadata = extractMetadata(event);

  await trace(traceId, "event.received", { type: event.type, priority: event.priority });
  await persistMessage({ role: "user", content: userMessage, metadata, traceId });

  const { systemPrompt, messages } = await assembleContext();
  await trace(traceId, "context.assembled", {
    messageCount: messages.length,
    systemPromptLength: systemPrompt.length,
    systemPrompt,
    messages,
  });

  const tools = getToolSchemas();
  await trace(traceId, "claude.request", { messageCount: messages.length, toolCount: tools.length });

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

  if (hasToolUse(response)) {
    await handleToolUseResponse({
      initialResponse: response, systemPrompt, tools, queue, chatId, traceId,
    });
    return;
  }

  const assistantText = extractTextContent(response);
  if (!assistantText.trim()) {
    warn("event", "Empty assistant response, skipping delivery");
    await trace(traceId, "response.empty", { stopReason: response.stop_reason });
    return;
  }
  await persistMessage({ role: "assistant", content: assistantText, traceId });
  await deliverResponse(assistantText, chatId, traceId);
}

function extractUserMessage(event: QueueEvent): string {
  const payload = event.payload as Record<string, unknown>;
  return (payload.text as string) ?? JSON.stringify(payload);
}

function extractChatId(event: QueueEvent): number | null {
  const payload = event.payload as Record<string, unknown>;
  return (payload.chat_id as number) ?? null;
}

function extractMetadata(event: QueueEvent): Record<string, unknown> {
  const payload = event.payload as Record<string, unknown>;
  return (payload.audio_metadata as Record<string, unknown>) ?? {};
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
