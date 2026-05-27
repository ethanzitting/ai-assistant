import { Bot } from "grammy";
import type { EventQueue } from "@/eventQueue.ts";
import { db } from "@/db.ts";

const OWNER_ID = Deno.env.get("TELEGRAM_OWNER_ID");

export function createTelegramBot(queue: EventQueue): Bot {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");

  const bot = new Bot(token);

  bot.on("message:text", async (ctx) => {
    const userId = String(ctx.from.id);

    if (OWNER_ID && userId !== OWNER_ID) {
      console.warn(`[telegram] Rejected message from unknown user ${userId}`);
      return;
    }

    if (!OWNER_ID) {
      console.log(`[telegram] No TELEGRAM_OWNER_ID set. Message from user ${userId} — set this as TELEGRAM_OWNER_ID to lock access.`);
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

  bot.catch((err) => {
    console.error("[telegram] Bot error:", err.message);
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

