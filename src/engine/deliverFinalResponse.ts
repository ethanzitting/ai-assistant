import type { Message } from "@anthropic-ai/sdk/resources/messages.mjs";
import { persistMessage } from "@/conversationHistory.ts";
import { extractTextContent } from "@/engine/parseResponse.ts";
import { sendTelegramMessage } from "@/telegram/sendTelegramMessage.ts";
import { info, warn } from "@/logger.ts";
import { trace } from "@/trace.ts";

export async function deliverFinalResponse(
  response: Message,
  hitMaxIterations: boolean,
  chatId: number | null,
  traceId: string,
): Promise<void> {
  const finalText = extractTextContent(response).trim();

  if (!finalText) {
    warn("tool-loop", "Empty final response, using fallback", { hitMaxIterations });
    await trace(traceId, "response.empty", { hitMaxIterations });
  }

  // Always deliver something — a user-initiated turn should never end in silence.
  const deliverText = finalText || fallbackText(hitMaxIterations);

  await persistMessage({ role: "assistant", content: deliverText, traceId });
  info("assistant", deliverText);
  if (chatId) await sendTelegramMessage(chatId, deliverText);
  await trace(traceId, "response.delivered", {
    channel: chatId ? "telegram" : "none",
    chatId,
    text: deliverText,
  });
}

function fallbackText(hitMaxIterations: boolean): string {
  if (hitMaxIterations) {
    return "I wasn't able to finish that one — I got stuck partway through and couldn't pull together a complete answer. Mind rephrasing, or give me a moment and try again?";
  }
  return "Hmm, I don't have a response for that — something may have gone sideways on my end. Mind trying again?";
}
