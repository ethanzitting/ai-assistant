import type { Context } from "grammy";
import type { EventQueue } from "@/engine/eventQueue.ts";
import { downloadTelegramFile } from "@/audio/downloadTelegramFile.ts";
import { indexPhoto } from "@/archive/indexPhoto.ts";
import { photoEmbeddingText } from "@/embeddings/embeddingText.ts";
import { VISION_MODEL } from "@/vision/visionModel.ts";
import { requireEnv } from "@/requireEnv.ts";
import { error } from "@/logger.ts";

const MAX_FILE_SIZE = 100 * 1024 * 1024;

export async function handlePhotoMessage(
  ctx: Context,
  queue: EventQueue,
  internalChatId?: string,
  chatType?: string,
): Promise<void> {
  try {
    const photos = ctx.message?.photo;
    if (!photos || photos.length === 0) return;

    const photo = photos[photos.length - 1];
    if (photo.file_size && photo.file_size > MAX_FILE_SIZE) {
      await ctx.reply(
        "That image is too large for me to process (100MB limit).",
      );
      return;
    }

    await ctx.react("👀");

    const file = await ctx.api.getFile(photo.file_id);
    if (!file.file_path) throw new Error("Telegram did not return a file_path");

    const botToken = requireEnv("TELEGRAM_BOT_TOKEN");
    const fileBytes = await downloadTelegramFile(file.file_path, botToken);

    const { archiveId, ocrText, visionDescription } = await indexPhoto(
      fileBytes,
      photo.file_id,
    );

    const caption = ctx.message?.caption;
    const describedContent = photoEmbeddingText({ visionDescription, ocrText });
    let messageText = describedContent
      ? `[Photo]\n${describedContent}`
      : "[Photo]";
    if (caption) messageText += `\n\nCaption: ${caption}`;
    if (archiveId) messageText += `\n\nArchive ID: ${archiveId}`;

    const imageMetadata: Record<string, unknown> = {
      source: "photo",
      telegram_file_id: photo.file_id,
      mime_type: "image/jpeg",
      ocr_model: "mistral-ocr-latest",
    };
    if (photo.file_size) imageMetadata.file_size_bytes = photo.file_size;
    if (archiveId) imageMetadata.archive_id = archiveId;
    if (visionDescription) imageMetadata.vision_model = VISION_MODEL;

    const isPrivate = !chatType || chatType === "private";
    const senderLabel = isPrivate ? "" : `[${senderNameFrom(ctx)}]: `;
    const respond = isPrivate || isAddressedInCaption(ctx);

    await ctx.react("👍");

    queue.push({
      id: crypto.randomUUID(),
      type: "user_message",
      priority: "high",
      payload: {
        text: `${senderLabel}${messageText}`,
        chat_id: ctx.chat!.id,
        internal_chat_id: internalChatId,
        chat_type: chatType,
        sender_name: senderNameFrom(ctx),
        sender_id: ctx.from ? String(ctx.from.id) : undefined,
        reply_to_message_id: ctx.message?.reply_to_message?.message_id,
        respond,
        image_metadata: imageMetadata,
      },
      createdAt: new Date(),
    });
  } catch (err) {
    error("photo", "Failed to process photo message", { error: String(err) });
    await ctx.reply(
      "Sorry, I had trouble processing that image. Please try again.",
    ).catch(() => {});
  }
}

function isAddressedInCaption(ctx: Context): boolean {
  const botUsername = ctx.me.username;
  if (!botUsername) return false;

  const msg = ctx.message;
  if (!msg) return false;

  if (msg.reply_to_message?.from?.id === ctx.me.id) return true;

  const caption = msg.caption;
  if (caption && caption.includes(`@${botUsername}`)) return true;

  return false;
}

function senderNameFrom(ctx: Context): string {
  if (!ctx.from) return "Unknown";
  return [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ");
}
