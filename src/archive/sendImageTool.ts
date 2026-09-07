import * as v from "valibot";
import type { ToolDefinition, ToolResult } from "@/tools/toolTypes.ts";
import { parseToolInput } from "@/tools/parseToolInput.ts";
import { resolveChatId } from "@/telegram/resolveChatId.ts";
import { sendTelegramPhoto } from "@/telegram/sendTelegramPhoto.ts";
import { db } from "@/db.ts";
import { trace } from "@/trace.ts";
import { warn } from "@/logger.ts";

const sendImageInputSchema = v.object({
  archived_file_id: v.pipe(v.string(), v.uuid()),
  caption: v.optional(v.string()),
  chat: v.optional(v.string()),
});

export const sendImageTool: ToolDefinition = {
  schema: {
    name: "send_image",
    description:
      "Send an archived image back to the user in Telegram. Use the file id from a search_archives hit marked 'sendable image'. The image itself is delivered — do not also describe it at length or paste its indexed text. Call once per image; sending two images means two calls.",
    inputSchema: {
      type: "object" as const,
      properties: {
        archived_file_id: {
          type: "string",
          description: "The file id shown in the search_archives result.",
        },
        caption: {
          type: "string",
          description: "Optional one-line caption sent with the image.",
        },
        chat: {
          type: "string",
          description:
            "Target chat name (e.g. 'Dana Care'). Omit to send to the chat you're replying in.",
        },
      },
      required: ["archived_file_id"],
    },
  },
  handle: handleSendImage,
};

async function handleSendImage(
  input: Record<string, unknown>,
  traceId: string,
  telegramChatId?: number | null,
): Promise<ToolResult> {
  const parsed = parseToolInput(
    sendImageInputSchema,
    input,
    '{ archived_file_id: "uuid from search_archives", caption?: "short caption", chat?: "group name" }',
  );
  if (!parsed.success) return parsed.error;

  const { archived_file_id: archivedFileId, caption, chat } = parsed.data;

  const telegramFileId = await findTelegramFileId(archivedFileId);
  if (!telegramFileId) {
    return { content: "That archived file has no sendable image.", isError: true };
  }

  // An image is nearly always the answer to something asked in this chat, so the turn's own chat
  // wins unless the model names a different one. Falling back to resolveChatId covers proactive sends
  // from scheduled events, which have no originating chat.
  const chatId = chat ? await resolveChatId(chat) : telegramChatId ?? await resolveChatId();
  if (!chatId) {
    const target = chat ?? "private";
    warn("telegram", "No chat found for send_image", { target });
    return { content: `Cannot send — no chat found matching "${target}".`, isError: true };
  }

  try {
    await sendTelegramPhoto(chatId, telegramFileId, caption);
  } catch (err: unknown) {
    warn("telegram", "send_image failed", {
      archivedFileId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { content: "Couldn't send that image — Telegram rejected the file.", isError: true };
  }

  await trace(traceId, "archive.send_image", { archivedFileId, chatId });
  return { content: "Image sent." };
}

async function findTelegramFileId(archivedFileId: string): Promise<string | null> {
  const rows = await db`
    SELECT telegram_file_id FROM archived_files WHERE id = ${archivedFileId}
  `;
  if (rows.length === 0) return null;
  return (rows[0].telegram_file_id as string | null) ?? null;
}
