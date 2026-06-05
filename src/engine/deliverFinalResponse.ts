import type { Message } from "@anthropic-ai/sdk/resources/messages.mjs";
import { persistMessage } from "@/conversationHistory.ts";
import { extractTextContent } from "@/engine/parseResponse.ts";
import { sendTelegramMessage } from "@/telegram/sendTelegramMessage.ts";
import { info, warn } from "@/logger.ts";
import { trace } from "@/trace.ts";

export async function deliverFinalResponse(
  response: Message,
  hitMaxIterations: boolean,
  telegramChatId: number | null,
  internalChatId: string | undefined,
  respond: boolean,
  traceId: string,
): Promise<void> {
  const finalText = extractTextContent(response).trim();

  if (!finalText) {
    warn("tool-loop", "Empty final response, using fallback", { hitMaxIterations });
    await trace(traceId, "response.empty", { hitMaxIterations });
  }

  const deliverText = finalText || fallbackText(hitMaxIterations);

  if (!respond) {
    await trace(traceId, "response.suppressed", { text: deliverText });
    return;
  }

  await persistMessage({ role: "assistant", content: deliverText, chatId: internalChatId, traceId });

  info("assistant", deliverText);
  if (telegramChatId) await sendTelegramMessage(telegramChatId, deliverText);
  await trace(traceId, "response.delivered", {
    channel: telegramChatId ? "telegram" : "none",
    chatId: telegramChatId,
    text: deliverText,
  });
}

function fallbackText(hitMaxIterations: boolean): string {
  if (hitMaxIterations) {
    return "I wasn't able to finish that one — I got stuck partway through and couldn't pull together a complete answer. Mind rephrasing, or give me a moment and try again?";
  }
  return "Hmm, I don't have a response for that — something may have gone sideways on my end. Mind trying again?";
}
