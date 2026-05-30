import type { Context } from "grammy";
import type { EventQueue } from "@/engine/eventQueue.ts";
import { downloadTelegramFile } from "@/audio/downloadTelegramFile.ts";
import { ocrImage } from "@/ocr/ocrImage.ts";
import { archiveFile } from "@/archive/archiveFile.ts";
import { error } from "@/logger.ts";

const MAX_FILE_SIZE = 100 * 1024 * 1024;

export async function handlePhotoMessage(
  ctx: Context,
  queue: EventQueue,
): Promise<void> {
  try {
    const photos = ctx.message?.photo;
    if (!photos || photos.length === 0) return;

    const photo = photos[photos.length - 1];
    if (photo.file_size && photo.file_size > MAX_FILE_SIZE) {
      await ctx.reply("That image is too large for me to process (100MB limit).");
      return;
    }

    await ctx.reply("Reading image...");

    const file = await ctx.api.getFile(photo.file_id);
    if (!file.file_path) throw new Error("Telegram did not return a file_path");

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    const fileBytes = await downloadTelegramFile(file.file_path, botToken);

    let archiveId: string | null = null;
    try {
      archiveId = await archiveFile({
        fileBytes,
        sourceType: "photo",
        label: photo.file_id,
        ext: "jpg",
        mimeType: "image/jpeg",
      });
    } catch (err) {
      error("archive", "Photo archival failed, continuing", { error: String(err) });
    }

    const ocrText = await ocrImage(fileBytes, "image/jpeg");

    if (!ocrText) {
      await ctx.reply("I couldn't find any text in that image.");
      return;
    }

    let textArchiveId: string | null = null;
    try {
      const textBytes = new TextEncoder().encode(ocrText);
      const metadata: Record<string, unknown> = {};
      if (archiveId) metadata.source_file_id = archiveId;

      textArchiveId = await archiveFile({
        fileBytes: textBytes.buffer as ArrayBuffer,
        sourceType: "ocr_text",
        label: photo.file_id,
        ext: "txt",
        mimeType: "text/plain",
        metadata,
      });
    } catch (err) {
      error("archive", "OCR text archival failed, continuing", { error: String(err) });
    }

    const caption = ctx.message?.caption;
    let messageText = `[Photo]\n${ocrText}`;
    if (caption) messageText += `\n\nCaption: ${caption}`;

    const imageMetadata: Record<string, unknown> = {
      source: "photo",
      telegram_file_id: photo.file_id,
      mime_type: "image/jpeg",
      ocr_model: "mistral-ocr-latest",
    };
    if (photo.file_size) imageMetadata.file_size_bytes = photo.file_size;
    if (archiveId) imageMetadata.archive_id = archiveId;
    if (textArchiveId) imageMetadata.ocr_text_archive_id = textArchiveId;

    queue.push({
      id: crypto.randomUUID(),
      type: "user_message",
      priority: "high",
      payload: {
        text: messageText,
        chat_id: ctx.chat!.id,
        image_metadata: imageMetadata,
      },
      createdAt: new Date(),
    });
  } catch (err) {
    error("photo", "Failed to process photo message", { error: String(err) });
    await ctx.reply("Sorry, I had trouble processing that image. Please try again.").catch(() => {});
  }
}
