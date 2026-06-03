import type { Context } from "grammy";
import type { EventQueue } from "@/engine/eventQueue.ts";
import { downloadTelegramFile } from "@/audio/downloadTelegramFile.ts";
import { ocrImage } from "@/ocr/ocrImage.ts";
import { archiveFile } from "@/archive/archiveFile.ts";
import { embedArchivedFile } from "@/archive/embedArchivedFile.ts";
import { classifyDocument, extensionForDocument } from "@/telegram/documentTypes.ts";
import { requireEnv } from "@/requireEnv.ts";
import { error } from "@/logger.ts";

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_TEXT_BYTES = 512 * 1024;

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
    const docClass = classifyDocument(mimeType, doc.file_name);
    if (!docClass) return;

    const sizeLimit = docClass === "text" ? MAX_TEXT_BYTES : MAX_FILE_SIZE;
    if (doc.file_size && doc.file_size > sizeLimit) {
      const limitLabel = docClass === "text" ? "512KB" : "100MB";
      await ctx.reply(`That document is too large for me to process (${limitLabel} limit).`);
      return;
    }

    await ctx.reply("Reading document...");

    const file = await ctx.api.getFile(doc.file_id);
    if (!file.file_path) throw new Error("Telegram did not return a file_path");

    const botToken = requireEnv("TELEGRAM_BOT_TOKEN");
    const fileBytes = await downloadTelegramFile(file.file_path, botToken);

    const ext = extensionForDocument(mimeType, doc.file_name);
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

    let extractedText: string | null;
    let extractionModel: string;

    if (docClass === "text") {
      extractedText = new TextDecoder("utf-8", { fatal: false }).decode(fileBytes);
      extractionModel = "utf8-decode";
    } else {
      extractedText = await ocrImage(fileBytes, mimeType);
      extractionModel = "mistral-ocr-latest";
    }

    if (!extractedText) {
      await ctx.reply("I couldn't find any text in that document.");
      return;
    }

    if (docClass === "ocr") {
      try {
        const textBytes = new TextEncoder().encode(extractedText);
        const metadata: Record<string, unknown> = {};
        if (archiveId) metadata.source_file_id = archiveId;

        await archiveFile({
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
    }

    if (archiveId) {
      await embedArchivedFile({
        archivedFileId: archiveId,
        sourceType: "document",
        text: extractedText,
        metadata: { telegram_file_id: doc.file_id, original_filename: doc.file_name },
      });
    }

    const filename = doc.file_name ?? "document";
    const caption = ctx.message?.caption;
    let messageText = `[Document: ${filename}]\n${extractedText}`;
    if (caption) messageText += `\n\nCaption: ${caption}`;

    const isPrivate = !chatType || chatType === "private";
    const senderLabel = isPrivate ? "" : `[${senderNameFrom(ctx)}]: `;
    const respond = isPrivate || isAddressedInCaption(ctx);

    const documentMetadata: Record<string, unknown> = {
      source: "document",
      telegram_file_id: doc.file_id,
      mime_type: mimeType,
      extraction_model: extractionModel,
      original_filename: doc.file_name,
    };
    if (doc.file_size) documentMetadata.file_size_bytes = doc.file_size;
    if (archiveId) documentMetadata.archive_id = archiveId;

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
        document_metadata: documentMetadata,
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
