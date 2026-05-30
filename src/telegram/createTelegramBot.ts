import { Bot } from "grammy";
import type { EventQueue } from "@/engine/eventQueue.ts";
import { db } from "@/db.ts";
import { handleVoiceMessage } from "@/telegram/handleVoiceMessage.ts";
import { warn, error } from "@/logger.ts";

const OWNER_ID = Deno.env.get("TELEGRAM_OWNER_ID");

export function createTelegramBot(queue: EventQueue): Bot {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");

  const apiRoot = Deno.env.get("TELEGRAM_API_URL");
  if (!apiRoot) throw new Error("TELEGRAM_API_URL is not set");

  const bot = new Bot(token, { client: { apiRoot } });

  bot.on("message:text", async (ctx) => {
    const userId = String(ctx.from.id);

    if (OWNER_ID && userId !== OWNER_ID) {
      warn("telegram", "Rejected message from unknown user", { userId });
      return;
    }

    if (!OWNER_ID) {
      warn("telegram", "No TELEGRAM_OWNER_ID set", { userId });
    }

    await persistChatId(ctx.chat.id);

    queue.push({
      id: crypto.randomUUID(),
      type: "user_message",
      priority: "high",
      payload: {
        text: ctx.message.text,
        chat_id: ctx.chat.id,
      },
      createdAt: new Date(),
    });
  });

  bot.on(["message:voice", "message:audio", "message:video", "message:video_note"], async (ctx) => {
    const userId = String(ctx.from.id);

    if (OWNER_ID && userId !== OWNER_ID) {
      warn("telegram", "Rejected voice/audio from unknown user", { userId });
      return;
    }

    await persistChatId(ctx.chat.id);
    await handleVoiceMessage(ctx, queue);
  });

  bot.catch((err) => {
    error("telegram", "Bot error", { error: err.message });
  });

  return bot;
}

async function persistChatId(chatId: number): Promise<void> {
  await db`
    INSERT INTO preferences (key, value, source)
    VALUES ('telegram_chat_id', ${JSON.stringify(chatId)}, 'telegram_bot')
    ON CONFLICT (key) DO NOTHING
  `;
}
