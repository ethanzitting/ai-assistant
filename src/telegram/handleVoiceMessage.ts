import type { Context } from "grammy";
import type { EventQueue } from "@/engine/eventQueue.ts";
import { downloadTelegramFile } from "@/audio/downloadTelegramFile.ts";
import { transcribeAudio } from "@/audio/transcribeAudio.ts";
import { archiveFile } from "@/archive/archiveFile.ts";
import { requireEnv } from "@/requireEnv.ts";
import { error } from "@/logger.ts";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB practical limit for in-memory processing

export async function handleVoiceMessage(
  ctx: Context,
  queue: EventQueue,
): Promise<void> {
  try {
    const media = extractMediaInfo(ctx);
    if (!media) return;

    const { fileId, duration, mimeType, fileSize, originalFilename, sourceType, label } = media;

    if (fileSize && fileSize > MAX_FILE_SIZE) {
      await ctx.reply(
        "That file is too large for me to process right now (100MB limit). Try a shorter clip.",
      );
      return;
    }

    await ctx.reply("Transcribing...");

    const file = await ctx.getFile();
    if (!file.file_path) throw new Error("Telegram did not return a file_path");

    const botToken = requireEnv("TELEGRAM_BOT_TOKEN");
    const fileBytes = await downloadTelegramFile(file.file_path, botToken);

    const ext = extensionFromMime(mimeType);
    let archiveId: string | null = null;
    try {
      archiveId = await archiveFile({
        fileBytes,
        sourceType,
        label: fileId,
        ext,
        mimeType,
        originalFilename,
      });
    } catch (err) {
      error("archive", "Audio archival failed, continuing", { error: String(err) });
    }

    const transcript = await transcribeAudio(fileBytes, mimeType);

    if (!transcript) {
      await ctx.reply("I couldn't make out any speech in that recording.");
      return;
    }

    let transcriptArchiveId: string | null = null;
    try {
      const transcriptBytes = new TextEncoder().encode(transcript);
      const metadata: Record<string, unknown> = {};
      if (archiveId) metadata.source_file_id = archiveId;

      transcriptArchiveId = await archiveFile({
        fileBytes: transcriptBytes.buffer as ArrayBuffer,
        sourceType: "transcript",
        label: fileId,
        ext: "txt",
        mimeType: "text/plain",
        metadata,
      });
    } catch (err) {
      error("archive", "Transcript archival failed, continuing", { error: String(err) });
    }

    const audioMetadata: Record<string, unknown> = {
      source: sourceType,
      telegram_file_id: fileId,
      duration_seconds: duration,
      mime_type: mimeType,
      transcript_model: "nova-2",
    };
    if (fileSize) audioMetadata.file_size_bytes = fileSize;
    if (archiveId) audioMetadata.archive_id = archiveId;
    if (transcriptArchiveId) audioMetadata.transcript_archive_id = transcriptArchiveId;

    queue.push({
      id: crypto.randomUUID(),
      type: "user_message",
      priority: "high",
      payload: {
        text: `[${label}, ${duration}s]\n${transcript}`,
        chat_id: ctx.chat!.id,
        audio_metadata: audioMetadata,
      },
      createdAt: new Date(),
    });
  } catch (err) {
    error("media", "Failed to process media message", { error: String(err) });
    await ctx.reply("Sorry, I had trouble processing that. Please try again.").catch(() => {});
  }
}

interface MediaInfo {
  fileId: string;
  duration: number;
  mimeType: string;
  fileSize: number | undefined;
  originalFilename: string | undefined;
  sourceType: string;
  label: string;
}

function extractMediaInfo(ctx: Context): MediaInfo | null {
  const msg = ctx.message;
  if (!msg) return null;

  if (msg.voice) {
    return {
      fileId: msg.voice.file_id,
      duration: msg.voice.duration,
      mimeType: "audio/ogg",
      fileSize: msg.voice.file_size,
      originalFilename: undefined,
      sourceType: "voice_memo",
      label: "Voice message",
    };
  }

  if (msg.audio) {
    return {
      fileId: msg.audio.file_id,
      duration: msg.audio.duration,
      mimeType: msg.audio.mime_type ?? "audio/mpeg",
      fileSize: msg.audio.file_size,
      originalFilename: msg.audio.file_name,
      sourceType: "audio",
      label: "Audio file",
    };
  }

  if (msg.video) {
    return {
      fileId: msg.video.file_id,
      duration: msg.video.duration,
      mimeType: msg.video.mime_type ?? "video/mp4",
      fileSize: msg.video.file_size,
      originalFilename: msg.video.file_name,
      sourceType: "video",
      label: "Video message",
    };
  }

  if (msg.video_note) {
    return {
      fileId: msg.video_note.file_id,
      duration: msg.video_note.duration,
      mimeType: "video/mp4",
      fileSize: msg.video_note.file_size,
      originalFilename: undefined,
      sourceType: "video_note",
      label: "Video note",
    };
  }

  return null;
}

function extensionFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/flac": "flac",
    "audio/webm": "webm",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
  };
  return map[mimeType] ?? "bin";
}
