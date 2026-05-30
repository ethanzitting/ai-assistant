# Mistral OCR Image & Document Parsing

## Context

The assistant handles voice, audio, video, and video note messages from Telegram — downloads the file, archives to B2, transcribes via Deepgram, archives the transcript, and queues it as a user message. Photos and documents are currently ignored. Adding Mistral OCR gives the assistant the ability to read text from photos (receipts, letters, screenshots) and documents (PDFs, image files sent as attachments).

This follows the exact same orchestration pattern as audio/video: download → archive → process → archive result → queue.

## Approach

Three new files, three small modifications. No database or schema changes needed — `archived_files` and `conversations` already support arbitrary source types and JSON metadata.

### New files

**`src/ocr/ocrImage.ts`** (~40 lines) — Mistral OCR REST call. Mirrors `src/audio/transcribeAudio.ts`.

- POST to `https://api.mistral.ai/v1/ocr` with `model: "mistral-ocr-latest"`
- Image/PDF sent as base64 data URL in `document.document_url` field
- Auth via `Authorization: Bearer ${MISTRAL_API_KEY}`
- 60s timeout (matching Deepgram)
- Parse response: join `pages[].markdown` with double newlines
- Return `string | null` — null when no text found
- Include `arrayBufferToBase64()` helper (loop-based, safe for large files)

**`src/telegram/handlePhotoMessage.ts`** (~70 lines) — Photo orchestrator. Mirrors `src/telegram/handleVoiceMessage.ts`.

1. Extract highest-resolution photo from `ctx.message.photo` (last element of array)
2. Validate file size (100MB limit)
3. Reply "Reading image..."
4. Download via `downloadTelegramFile` (reused from `src/audio/`)
5. Archive original to B2 with `sourceType: "photo"` (non-fatal)
6. Call `ocrImage(fileBytes, "image/jpeg")`
7. If null → reply "I couldn't find any text in that image." and return
8. Archive OCR text to B2 with `sourceType: "ocr_text"` and `metadata.source_file_id` backlink (non-fatal)
9. Queue as `user_message` with `image_metadata` in payload
10. Message text format: `[Photo]\n${ocrText}` — append `\n\nCaption: ${caption}` if `ctx.message.caption` exists

**`src/telegram/handleDocumentMessage.ts`** (~80 lines) — Document orchestrator. Same pattern as photo handler, adapted for documents.

1. Extract `ctx.message.document` — get `file_id`, `file_name`, `mime_type`, `file_size`
2. Check MIME type against allowlist — reject non-OCR types with no reply (silent ignore for non-image/PDF docs)
3. Validate file size (100MB limit)
4. Reply "Reading document..."
5. Download, archive with `sourceType: "document"`, OCR, archive OCR text — same archive-first pattern
6. Extension from `file_name` or MIME type for archival
7. Queue with text: `[Document: filename.pdf]\n${ocrText}` — append caption if present
8. `image_metadata.source` is `"document"` instead of `"photo"`

OCR-compatible MIME types:
```
image/jpeg, image/png, image/gif, image/webp, image/tiff, image/bmp
application/pdf
```

### Modified files

**`src/telegram/createTelegramBot.ts`** — Add two new handlers after the voice/audio/video block:
- `bot.on("message:photo")` → delegates to `handlePhotoMessage`
- `bot.on("message:document")` → checks MIME type, delegates to `handleDocumentMessage`
- Same owner validation + `persistChatId` pattern as existing handlers

**`src/engine/processEvent.ts`** — One-line change in `extractMetadata()` to also check `payload.image_metadata`:
```
return (payload.audio_metadata as Record<string, unknown>)
  ?? (payload.image_metadata as Record<string, unknown>)
  ?? {};
```

**`.env.tpl` + `docker-compose.yml`** — Add `MISTRAL_API_KEY` env var following the existing 1Password pattern.

### What doesn't change

- `src/archive/archiveFile.ts` — already generic
- `src/audio/downloadTelegramFile.ts` — reused as-is (generic fetch)
- `src/prompt/buildSystemPrompt.ts` — no mention needed; `[Photo]`/`[Document]` prefix gives Claude context
- Database schema — `archived_files` and `conversations` both handle arbitrary types/metadata
- `deno.json` — no new dependencies (raw REST via fetch)

## Implementation order

1. `src/ocr/ocrImage.ts` (standalone, testable independently)
2. `src/telegram/handlePhotoMessage.ts` (depends on 1)
3. `src/telegram/handleDocumentMessage.ts` (depends on 1, parallel with 2)
4. `src/telegram/createTelegramBot.ts` modification (depends on 2-3)
5. `src/engine/processEvent.ts` modification (independent)
6. `.env.tpl` + `docker-compose.yml` (independent)

## Verification

1. `deno check src/main.ts` — all imports resolve
2. Send a photo of a receipt → "Reading image..." → agent responds to the text content
3. Send a photo with no text (landscape) → "I couldn't find any text in that image."
4. Send a photo with a caption → caption appears after OCR text
5. Send a PDF as a document attachment → "Reading document..." → agent responds to the content
6. Send a PNG/image as a document → same OCR behavior
7. Send a non-image document (ZIP, MP3) → silently ignored (no reply)
8. Check B2: `archive/YYYY/MM/photo/` and `archive/YYYY/MM/document/` have files and companion `.txt`
9. Check `archived_files` table: OCR text rows backlink via `metadata.source_file_id`
