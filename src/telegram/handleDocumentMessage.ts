import type { Context } from "grammy";
import type { EventQueue } from "@/engine/eventQueue.ts";
import { downloadTelegramFile } from "@/audio/downloadTelegramFile.ts";
import { ocrImage } from "@/ocr/ocrImage.ts";
import { archiveFile } from "@/archive/archiveFile.ts";
import { embedArchivedFile } from "@/archive/embedArchivedFile.ts";
import { requireEnv } from "@/requireEnv.ts";
import { error } from "@/logger.ts";

const MAX_FILE_SIZE = 100 * 1024 * 1024;

const OCR_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/tiff",
  "image/bmp",
  "application/pdf",
]);

export async function handleDocumentMessage(
  ctx: Context,
  queue: EventQueue,
  internalChatId?: string,
  chatType?: string,
): Promise<void> {
  try {
    const doc = ctx.message?.document;
    if (!doc) return;

    const mimeType = doc.mime_type ?? "";
    if (!OCR_MIME_TYPES.has(mimeType)) return;

    if (doc.file_size && doc.file_size > MAX_FILE_SIZE) {
      await ctx.reply("That document is too large for me to process (100MB limit).");
      return;
    }

    await ctx.reply("Reading document...");

    const file = await ctx.api.getFile(doc.file_id);
    if (!file.file_path) throw new Error("Telegram did not return a file_path");

    const botToken = requireEnv("TELEGRAM_BOT_TOKEN");
    const fileBytes = await downloadTelegramFile(file.file_path, botToken);

    const ext = extensionFromMime(mimeType);
    let archiveId: string | null = null;
    try {
      archiveId = await archiveFile({
        fileBytes,
        sourceType: "document",
        label: doc.file_id,
        ext,
        mimeType,
        originalFilename: doc.file_name,
      });
    } catch (err) {
      error("archive", "Document archival failed, continuing", { error: String(err) });
    }

    const ocrText = await ocrImage(fileBytes, mimeType);

    if (!ocrText) {
      await ctx.reply("I couldn't find any text in that document.");
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
        label: doc.file_id,
        ext: "txt",
        mimeType: "text/plain",
        metadata,
      });
    } catch (err) {
      error("archive", "OCR text archival failed, continuing", { error: String(err) });
    }

    const filename = doc.file_name ?? "document";
    const caption = ctx.message?.caption;
    let messageText = `[Document: ${filename}]\n${ocrText}`;
    if (caption) messageText += `\n\nCaption: ${caption}`;

    const imageMetadata: Record<string, unknown> = {
      source: "document",
      telegram_file_id: doc.file_id,
      mime_type: mimeType,
      ocr_model: "mistral-ocr-latest",
      original_filename: doc.file_name,
    };
    if (doc.file_size) imageMetadata.file_size_bytes = doc.file_size;
    if (archiveId) imageMetadata.archive_id = archiveId;
    if (textArchiveId) imageMetadata.ocr_text_archive_id = textArchiveId;

    if (archiveId) {
      await embedArchivedFile({
        archivedFileId: archiveId,
        sourceType: "document",
        text: ocrText,
        metadata: { telegram_file_id: doc.file_id, original_filename: doc.file_name },
      });
    }

    const isPrivate = !chatType || chatType === "private";
    const senderLabel = isPrivate ? "" : `[${senderNameFrom(ctx)}]: `;
    const respond = isPrivate || isAddressedInCaption(ctx);

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
        respond,
        image_metadata: imageMetadata,
      },
      createdAt: new Date(),
    });
  } catch (err) {
    error("document", "Failed to process document message", { error: String(err) });
    await ctx.reply("Sorry, I had trouble processing that document. Please try again.").catch(() => {});
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

function extensionFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/tiff": "tiff",
    "image/bmp": "bmp",
    "application/pdf": "pdf",
  };
  return map[mimeType] ?? "bin";
}
