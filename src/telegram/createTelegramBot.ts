import { Bot } from "grammy";
import type { Context } from "grammy";
import type { User } from "grammy/types";
import type { EventQueue } from "@/engine/eventQueue.ts";
import { ensureChat, getPrivateChat, getWatermark, markNotified } from "@/telegram/chatRegistry.ts";
import { persistMessage, estimateBacklogTokens } from "@/conversationHistory.ts";
import { handleVoiceMessage } from "@/telegram/handleVoiceMessage.ts";
import { handlePhotoMessage } from "@/telegram/handlePhotoMessage.ts";
import { handleDocumentMessage } from "@/telegram/handleDocumentMessage.ts";
import { sendTelegramMessage } from "@/telegram/sendTelegramMessage.ts";
import { requireEnv } from "@/requireEnv.ts";
import { info, warn, error } from "@/logger.ts";

const OWNER_ID = Deno.env.get("TELEGRAM_OWNER_ID");
const BACKLOG_TOKEN_THRESHOLD = 10_000;

const FLUSH_INSTRUCTION = "The conversation history contains unprocessed group messages. Extract all entities, facts, and relationships into the knowledge graph. Do not respond conversationally.";

const allowedChats = parseAllowedChats();
const pendingFlushes = new Set<string>();

export function createTelegramBot(queue: EventQueue): Bot {
  const token = requireEnv("TELEGRAM_BOT_TOKEN");
  const apiRoot = requireEnv("TELEGRAM_API_URL");

  const bot = new Bot(token, { client: { apiRoot } });

  bot.on("my_chat_member", async (ctx) => {
    await handleChatMemberUpdate(ctx);
  });

  bot.on("message:text", async (ctx) => {
    const access = checkAccess(ctx);
    if (access === "denied") {
      await notifyOwnerOfUnknown(ctx);
      return;
    }

    const chat = await ensureChat({
      telegramChatId: ctx.chat.id,
      type: ctx.chat.type,
      name: chatName(ctx),
    });

    const isPrivate = ctx.chat.type === "private";
    const addressed = isPrivate || isAddressedToBot(ctx);

    if (addressed) {
      const senderPrefix = isPrivate ? "" : `[${senderName(ctx.from)}]: `;
      queue.push({
        id: crypto.randomUUID(),
        type: "user_message",
        priority: "high",
        payload: {
          text: `${senderPrefix}${ctx.message.text}`,
          chat_id: ctx.chat.id,
          internal_chat_id: chat.id,
          chat_type: ctx.chat.type,
          sender_name: senderName(ctx.from),
          sender_id: String(ctx.from.id),
          respond: true,
        },
        createdAt: new Date(),
      });
    } else {
      await persistMessage({
        role: "context",
        content: `[${senderName(ctx.from)}]: ${ctx.message.text}`,
        chatId: chat.id,
        metadata: { sender_id: String(ctx.from.id) },
      });

      await maybeEnqueueFlush(queue, chat.id, ctx.chat.id, ctx.chat.type);
    }
  });

  bot.on(["message:voice", "message:audio", "message:video", "message:video_note"], async (ctx) => {
    const access = checkAccess(ctx);
    if (access === "denied") {
      await notifyOwnerOfUnknown(ctx);
      return;
    }

    const chat = await ensureChat({
      telegramChatId: ctx.chat.id,
      type: ctx.chat.type,
      name: chatName(ctx),
    });

    await handleVoiceMessage(ctx, queue, chat.id, ctx.chat.type);
  });

  bot.on("message:photo", async (ctx) => {
    const access = checkAccess(ctx);
    if (access === "denied") {
      await notifyOwnerOfUnknown(ctx);
      return;
    }

    const chat = await ensureChat({
      telegramChatId: ctx.chat.id,
      type: ctx.chat.type,
      name: chatName(ctx),
    });

    await handlePhotoMessage(ctx, queue, chat.id, ctx.chat.type);
  });

  bot.on("message:document", async (ctx) => {
    const access = checkAccess(ctx);
    if (access === "denied") {
      await notifyOwnerOfUnknown(ctx);
      return;
    }

    const chat = await ensureChat({
      telegramChatId: ctx.chat.id,
      type: ctx.chat.type,
      name: chatName(ctx),
    });

    await handleDocumentMessage(ctx, queue, chat.id, ctx.chat.type);
  });

  bot.catch((err) => {
    error("telegram", "Bot error", { error: err.message });
  });

  return bot;
}

function parseAllowedChats(): Set<string> {
  const raw = Deno.env.get("TELEGRAM_ALLOWED_CHATS");
  if (!raw) return new Set();
  return new Set(raw.split(",").map((id) => id.trim()).filter(Boolean));
}

type AccessResult = "owner" | "allowed" | "denied";

function checkAccess(ctx: Context): AccessResult {
  const userId = String(ctx.from?.id);
  const chatId = String(ctx.chat?.id);
  const isOwner = OWNER_ID && userId === OWNER_ID;

  if (isOwner && ctx.chat?.type === "private") return "owner";

  if (!isOwner && ctx.chat?.type === "private") {
    warn("telegram", "Rejected DM from non-owner", { userId });
    return "denied";
  }

  if (allowedChats.has(chatId)) return isOwner ? "owner" : "allowed";

  warn("telegram", "Rejected message from unknown chat", { chatId, userId });
  return "denied";
}

function isAddressedToBot(ctx: Context): boolean {
  const msg = ctx.message;
  if (!msg) return false;

  if (msg.reply_to_message?.from?.id === ctx.me.id) return true;

  const entities = msg.entities ?? [];
  const botUsername = ctx.me.username;
  if (botUsername) {
    for (const entity of entities) {
      if (entity.type === "mention") {
        const mentionText = msg.text?.substring(entity.offset, entity.offset + entity.length);
        if (mentionText === `@${botUsername}`) return true;
      }
      if (entity.type === "text_mention" && entity.user?.id === ctx.me.id) return true;
    }
  }

  return false;
}

function senderName(from: User): string {
  return [from.first_name, from.last_name].filter(Boolean).join(" ");
}

function chatName(ctx: Context): string | undefined {
  const chat = ctx.chat;
  if (!chat) return undefined;
  if ("title" in chat && chat.title) return chat.title;
  return undefined;
}

async function maybeEnqueueFlush(
  queue: EventQueue,
  internalChatId: string,
  telegramChatId: number,
  chatType: string,
): Promise<void> {
  if (pendingFlushes.has(internalChatId)) return;

  const watermark = await getWatermark(internalChatId);
  const backlogTokens = await estimateBacklogTokens(internalChatId, watermark);

  if (backlogTokens < BACKLOG_TOKEN_THRESHOLD) return;

  pendingFlushes.add(internalChatId);
  info("flush", "Token threshold crossed, enqueuing flush", { internalChatId, backlogTokens });

  queue.push({
    id: crypto.randomUUID(),
    type: "user_message",
    priority: "normal",
    payload: {
      text: FLUSH_INSTRUCTION,
      chat_id: telegramChatId,
      internal_chat_id: internalChatId,
      chat_type: chatType,
      respond: false,
    },
    createdAt: new Date(),
  });
}

export function clearPendingFlush(internalChatId: string): void {
  pendingFlushes.delete(internalChatId);
}

async function handleChatMemberUpdate(ctx: Context): Promise<void> {
  const update = ctx.myChatMember;
  if (!update || !ctx.chat) return;

  if (update.new_chat_member.status !== "member" && update.new_chat_member.status !== "administrator") return;

  const chat = ctx.chat;
  const chatId = chat.id;
  const chatTitle = ("title" in chat ? chat.title : undefined) ?? "private chat";
  const addedBy = senderName(update.from);

  await ensureChat({
    telegramChatId: chatId,
    type: chat.type,
    name: "title" in chat ? chat.title : undefined,
  });

  info("telegram", "Bot added to chat", { chatId, chatTitle, addedBy });

  const privateChat = await getPrivateChat();
  if (privateChat) {
    await sendTelegramMessage(
      privateChat.telegram_chat_id,
      `I was added to *${chatTitle}* (chat ID \`${chatId}\`) by ${addedBy}. Add \`${chatId}\` to TELEGRAM_ALLOWED_CHATS and \`make up\` to let me participate.`,
    );
  }
}

async function notifyOwnerOfUnknown(ctx: Context): Promise<void> {
  if (!ctx.from || !ctx.chat) return;

  const chatId = ctx.chat.id;
  const chatTitle = ("title" in ctx.chat ? ctx.chat.title : undefined) ?? "DM";
  const fromName = senderName(ctx.from);
  const fromId = ctx.from.id;

  const existing = await ensureChat({
    telegramChatId: chatId,
    type: ctx.chat.type,
    name: "title" in ctx.chat ? ctx.chat.title : undefined,
  });

  if (existing.notified_at) return;
  await markNotified(existing.id);

  const privateChat = await getPrivateChat();
  if (!privateChat) return;

  await sendTelegramMessage(
    privateChat.telegram_chat_id,
    `*${fromName}* (user \`${fromId}\`) tried to message me in *${chatTitle}* (chat ID \`${chatId}\`). Not processing — this source isn't allowlisted.`,
  );
}
