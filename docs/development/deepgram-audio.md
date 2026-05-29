# Deepgram Audio Transcription Integration

## Context

Send voice messages and audio files via Telegram, archive the raw audio to Backblaze B2, transcribe via Deepgram, and process the transcript through the existing event loop. This is Version 1 Phase 3 work — the agent container calls Deepgram and B2 directly (no ingestion container yet).

This is also the first use of B2 in the project. The `archived_files` table and B2 upload module are general-purpose infrastructure that will be reused for emails, documents, backups, and everything else that gets archived.

## Approach

**Deepgram:** Use the REST API directly (no SDK) — it's a single POST endpoint, and the `@deepgram/sdk` has Node.js-specific dependencies that create Deno friction.

**B2:** Use the S3-compatible API via `fetch`. B2's S3 endpoint (`s3.us-west-004.backblazeb2.com` or similar) accepts standard S3 PUT requests with AWS v4 signatures. Alternatively, use B2's native API which is simpler (authorize → get upload URL → upload). The native API is three REST calls and avoids needing an S3 signature library.

**Archive-first:** Download audio → archive to B2 → then transcribe. If transcription fails, the original is safe and can be reprocessed later. This follows the pattern established in the docs.

All audio stays in memory (Dockerfile has no `--allow-write`). The transcript gets pushed into the existing event queue as a `user_message`, so the entire downstream pipeline works unchanged.

## New infrastructure

### Migration: `migrations/006_archived_files.sql`

General-purpose file registry. Every file archived to B2 gets a row here.

```sql
CREATE TABLE IF NOT EXISTS archived_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type TEXT NOT NULL,
    b2_path TEXT NOT NULL,
    original_filename TEXT,
    mime_type TEXT,
    file_size_bytes BIGINT,
    sha256 TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_archived_files_source_type ON archived_files(source_type);
CREATE INDEX IF NOT EXISTS idx_archived_files_created_at ON archived_files(created_at);
```

`source_type` values: `voice_memo`, `audio`, `document`, `email`, `backup`, etc. The table is intentionally generic — all file types use it.

### Environment variables

Add to `.env.tpl`:
```
B2_KEY_ID=op://ai.assistant/B2_APP_KEY/key_id
B2_APPLICATION_KEY=op://ai.assistant/B2_APP_KEY/application_key
B2_BUCKET_NAME=op://ai.assistant/B2_BUCKET_NAME/notesPlain
```

Add to `docker-compose.yml` agent environment:
```
B2_KEY_ID: ${B2_KEY_ID}
B2_APPLICATION_KEY: ${B2_APPLICATION_KEY}
B2_BUCKET_NAME: ${B2_BUCKET_NAME}
```

### `src/archive/authorizeB2.ts`

Call `b2_authorize_account` with key ID and application key. Returns authorization token and API URL. Cache the token in memory — it's valid for 24 hours. Re-authorize on 401.

### `src/archive/uploadToB2.ts`

Takes `(fileBytes: ArrayBuffer, b2Path: string, mimeType: string)`, uploads to B2 using the native API:
1. Call `authorizeB2()` (cached)
2. Call `b2_get_upload_url` for the bucket
3. PUT the file bytes with SHA1 hash header
4. Return the B2 file ID and URL

### `src/archive/archiveFile.ts`

Orchestrator that uploads to B2 and records in the database:
1. Compute SHA256 of the file bytes
2. Build the B2 path following the convention: `archive/YYYY/MM/{source_type}/{timestamp}_{label}.{ext}`
3. Call `uploadToB2`
4. INSERT into `archived_files` table
5. Return the `archived_files` row ID

## New audio files

### `src/audio/transcribeAudio.ts`
POST audio bytes to `https://api.deepgram.com/v1/listen` with params: `model=nova-2`, `smart_format=true`, `punctuate=true`, `paragraphs=true`. Takes `(audioBytes: ArrayBuffer, mimeType: string)`, returns transcript string. Reads `DEEPGRAM_API_KEY` from env. Returns `"[Voice message contained no recognizable speech]"` if transcript is empty.

### `src/audio/downloadTelegramFile.ts`
Fetch file bytes from `https://api.telegram.org/file/bot<token>/<filePath>` as ArrayBuffer. Takes `(filePath: string, botToken: string)`, returns `ArrayBuffer`.

### `src/telegram/handleVoiceMessage.ts`
Orchestrator — ties download, archival, transcription, feedback, and queueing together:
1. Extract audio metadata (file_id, duration, mime_type) from the grammY context
2. Validate file size from Telegram's message metadata (available before download). If > 20MB, reply with a helpful message. Return early. This limit is removed in Version 2 via the Telegram Bot API Local Server.
3. Send "Transcribing your audio..." feedback to user
4. Download file via `downloadTelegramFile`
5. **Archive to B2** via `archiveFile` — archive-first, before transcription
6. Transcribe via `transcribeAudio`
7. Push to queue as `user_message` with `text: "[Voice message, Ns]\n<transcript>"` and `audio_metadata` in payload (includes `archive_id` from step 5)
8. Wrap in try/catch — on failure, reply with a friendly error message

## Modified files

### `src/telegram/createTelegramBot.ts`
Add a handler for `["message:voice", "message:audio"]` after the existing `message:text` handler. Same owner validation and `persistChatId` pattern. Delegates to `handleVoiceMessage(ctx, queue)`.

### `src/engine/processEvent.ts`
Extract `payload.audio_metadata` and pass it as the third arg to `persistMessage("user", userMessage, metadata)`. This is already supported — `persistMessage` accepts optional metadata. Text messages pass `{}` (no change in behavior).

## What doesn't change

- `eventQueue.ts` — event shape is compatible (payload is `unknown`)
- `runEventLoop.ts`, `handleToolUseResponse.ts` — no changes
- `conversationHistory.ts` — already accepts metadata
- `anthropic/*`, `prompt/*` — no changes
- `deno.json` — no new dependencies (using REST APIs directly)
- `Dockerfile` — `--allow-net` already covers Deepgram and B2 API calls

## Audio metadata stored in conversation

```json
{
  "source": "voice",
  "telegram_file_id": "...",
  "archive_id": "uuid-of-archived-files-row",
  "duration_seconds": 15,
  "mime_type": "audio/ogg",
  "file_size_bytes": 48000,
  "transcript_model": "nova-2"
}
```

## Implementation order

1. `migrations/006_archived_files.sql` — create the table
2. `src/archive/authorizeB2.ts`, `src/archive/uploadToB2.ts`, `src/archive/archiveFile.ts` — B2 infrastructure
3. `src/audio/transcribeAudio.ts` and `src/audio/downloadTelegramFile.ts` — Deepgram + Telegram download
4. `src/telegram/handleVoiceMessage.ts` — orchestrator (depends on steps 2-3)
5. `src/telegram/createTelegramBot.ts` modification — add voice/audio handler
6. `src/engine/processEvent.ts` modification — pass metadata to persistMessage
7. `.env.tpl` and `docker-compose.yml` — add B2 env vars

## Verification

1. `deno check src/main.ts` — all imports resolve, no type errors
2. Existing tests still pass: `deno test src/tests/`
3. `make migrate` — `006_archived_files.sql` runs cleanly
4. Manual test: send a voice memo → "Transcribing..." feedback → agent responds to transcript
5. Manual test: send an audio file → same behavior
6. Check B2 bucket: file appears at `archive/2026/05/voice_memo/{timestamp}_telegram.ogg`
7. Check database: `SELECT * FROM archived_files WHERE source_type = 'voice_memo'` — row exists with correct B2 path and SHA256
8. Check conversation metadata: `archive_id` points to the `archived_files` row
