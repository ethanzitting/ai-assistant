import { type Bot, InputFile } from "grammy";
import { generateText } from "ai";
import { getModel } from "@/ai/models.ts";
import { warn } from "@/logger.ts";

let botInstance: Bot | null = null;

export function setBotInstance(bot: Bot): void {
  botInstance = bot;
}

export function getBotInstance(): Bot | null {
  return botInstance;
}

const ATTACHMENT_THRESHOLD = 3000;
const MAX_CAPTION_LENGTH = 990;
const MAX_MESSAGE_LENGTH = 4096;

export async function sendTelegramMessage(
  chatId: number,
  text: string,
): Promise<void> {
  if (!botInstance) {
    warn("telegram", "Bot not initialized", { chatId });
    return;
  }

  if (text.length >= ATTACHMENT_THRESHOLD) {
    try {
      await sendAsDocument(chatId, text);
      return;
    } catch (error: unknown) {
      warn("telegram", "sendDocument failed, falling back to text", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const chunk of splitMessage(text)) {
    await botInstance.api.sendMessage(chatId, chunk);
  }
}

async function sendAsDocument(chatId: number, text: string): Promise<void> {
  const suffix = "\n\n… full response in the attachment above.";
  const caption = text.slice(0, MAX_CAPTION_LENGTH - suffix.length) + suffix;
  const filename = await generateFilename(text);
  const buffer = new TextEncoder().encode(text);
  const file = new InputFile(buffer, filename);
  await botInstance!.api.sendDocument(chatId, file, { caption });
}

async function generateFilename(text: string): Promise<string> {
  try {
    const response = await generateText({
      model: getModel("filename"),
      maxOutputTokens: 30,
      maxRetries: 1,
      reasoning: "none",
      abortSignal: AbortSignal.timeout(10_000),
      messages: [{
        role: "user",
        content:
          `Write a short filename (2-5 words, lowercase, hyphens, no extension) for this text:\n\n${
            text.slice(0, 300)
          }`,
      }],
    });
    const raw = response.text;
    const slug = raw.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(
      /^-|-$/g,
      "",
    );
    if (slug.length > 0 && slug.length <= 80) return slug + ".txt";
  } catch (error: unknown) {
    warn("telegram", "Filename generation failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return "response.txt";
}

function splitMessage(text: string): string[] {
  if (text.length <= MAX_MESSAGE_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > MAX_MESSAGE_LENGTH) {
    let splitAt = remaining.lastIndexOf("\n\n", MAX_MESSAGE_LENGTH);
    if (splitAt < 1) splitAt = remaining.lastIndexOf("\n", MAX_MESSAGE_LENGTH);
    if (splitAt < 1) splitAt = remaining.lastIndexOf(" ", MAX_MESSAGE_LENGTH);
    if (splitAt < 1) splitAt = MAX_MESSAGE_LENGTH;

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}
