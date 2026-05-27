import { sendMessage, type TokenUsage } from "@/anthropic/mod.ts";
import { getToolSchemas } from "@/tools/registry.ts";
import { persistMessage } from "@/conversation/messages.ts";
import { assembleContext } from "@/prompt/assemble.ts";
import { type QueueEvent, EventQueue } from "@/queue.ts";
import { handleToolUseResponse } from "@/engine/tool-loop.ts";
import { extractTextContent, hasToolUse } from "@/engine/helpers.ts";

export async function processEvent(
  event: QueueEvent,
  queue: EventQueue,
): Promise<void> {
  const userMessage = extractUserMessage(event);
  await persistMessage("user", userMessage);

  const { systemPrompt, messages } = await assembleContext();
  const tools = getToolSchemas();

  const { response, tokenUsage } = await sendMessage({
    systemPrompt,
    messages,
    tools,
  });

  logTokenUsage(tokenUsage);

  if (hasToolUse(response)) {
    await handleToolUseResponse(response, systemPrompt, tools, queue);
    return;
  }

  const assistantText = extractTextContent(response);
  await persistMessage("assistant", assistantText);
  console.log(`[assistant] ${assistantText}`);
}

function extractUserMessage(event: QueueEvent): string {
  const payload = event.payload as Record<string, unknown>;
  return (payload.text as string) ?? JSON.stringify(payload);
}

function logTokenUsage(tokenUsage: TokenUsage): void {
  console.log(
    `[tokens] in=${tokenUsage.inputTokens} out=${tokenUsage.outputTokens} ` +
      `cache_create=${tokenUsage.cacheCreationTokens} cache_read=${tokenUsage.cacheReadTokens}`,
  );
}
