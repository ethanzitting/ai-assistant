# Cleanup: reduce complexity in message handling pipeline

## Context

The message-batching and drain-persistence changes just landed. While reviewing the integration, several code smells surfaced — an untyped payload cast everywhere, a duplicated guard pattern across 4 bot handlers, drain logic that forces drain-then-re-push, and cross-file mutable state coupling. These are worth fixing now while the code is fresh, before more handlers or chat types pile on.

## Changes

### 1. Type the event payload — new `src/engine/eventPayload.ts`

`QueueEvent.payload` is `unknown`. Every consumer casts to `Record<string, unknown>` and pulls fields with individual casts (9 construction sites, 5 consumption sites). A shared type eliminates the casts and catches drift at compile time.

- Export `EventPayload` interface with all fields from the actual usage:
  ```
  text, chat_id, internal_chat_id, chat_type, sender_name?, sender_id?, respond,
  audio_metadata?, image_metadata?, document_metadata?
  ```
- Change `QueueEvent.payload` from `unknown` to `EventPayload` in `eventQueue.ts`
- Remove every `as Record<string, unknown>` cast from consumers: `processEvent.ts`, `handleToolUseResponse.ts`, `persistDrainedMessages.ts`, `runEventLoop.ts`
- Remove `TextMessagePayload` from `messageBatcher.ts` — it's now a subset of the shared type; import `EventPayload` instead
- Delete `extractMetadata` in `processEvent.ts` — replace with direct access: `payload.audio_metadata ?? payload.image_metadata ?? payload.document_metadata ?? {}`

### 2. Move drain filtering into the queue — `drainHighPriorityForChat` on `EventQueue`

Currently `drainHighPriority()` pulls all high-priority events, the caller filters by chat ID, then re-pushes the non-matching ones. The re-push window is a bug risk and the API doesn't match its usage.

- Add `drainHighPriorityForChat(chatId?: string): QueueEvent[]` to `EventQueue` — single-pass filter that only removes matching events, returns them. Non-matching events stay in the array, never leave.
- Remove old `drainHighPriority()` (no other callers).
- In `handleToolUseResponse.ts`: replace `drainHighPriorityContext` with a direct call to `queue.drainHighPriorityForChat(internalChatId)`. Extract interrupt text inline (3 lines). Delete the now-unnecessary private function and `DrainResult` interface.

### 3. Extract guard pattern in `createTelegramBot.ts`

The access-check + `ensureChat` block is copy-pasted across all 4 handlers (text, voice/audio, photo, document). Extract into a helper:

```
async function withAccessGuard(
  ctx: Context,
  handler: (chat: ChatRow) => Promise<void>,
): Promise<void>
```

Checks access, calls `notifyOwnerOfUnknown` on denial, calls `ensureChat`, then calls the handler with the chat row. Each `bot.on(...)` body shrinks to a one-liner calling `withAccessGuard`.

### 4. Move flush tracking into `EventQueue`

`pendingFlushes` is a module-level `Set<string>` in `createTelegramBot.ts`, but `processEvent.ts` reaches in via `clearPendingFlush` to mutate it — implicit cross-file state coupling.

- Add `hasPendingFlush(chatId)`, `markFlushPending(chatId)`, `clearFlush(chatId)` to `EventQueue`.
- `maybeEnqueueFlush` in `createTelegramBot.ts` uses `queue.hasPendingFlush` / `queue.markFlushPending`.
- `processEvent.ts` finally block uses `queue.clearFlush` — no import from `createTelegramBot`.
- Delete `pendingFlushes` Set and `clearPendingFlush` export from `createTelegramBot.ts`.

## Files touched

| File | Action |
|------|--------|
| `src/engine/eventPayload.ts` | **New** (~15 lines) — shared `EventPayload` type |
| `src/engine/eventQueue.ts` | Add `EventPayload` import, typed payload, `drainHighPriorityForChat`, flush tracking methods; remove `drainHighPriority` |
| `src/engine/handleToolUseResponse.ts` | Delete `drainHighPriorityContext` and `DrainResult`; use `queue.drainHighPriorityForChat` directly |
| `src/engine/processEvent.ts` | Remove payload casts, delete `extractMetadata`, use `queue.clearFlush` |
| `src/engine/persistDrainedMessages.ts` | Remove payload cast, use typed `EventPayload` |
| `src/engine/runEventLoop.ts` | Remove payload cast |
| `src/telegram/createTelegramBot.ts` | Extract `withAccessGuard`, use `queue.hasPendingFlush`/`markFlushPending`, remove `pendingFlushes`/`clearPendingFlush` |
| `src/telegram/messageBatcher.ts` | Replace `TextMessagePayload` with `EventPayload` import |

## Verification

1. `deno check src/main.ts`
2. `make dev` → send a message in private chat → verify response arrives
3. Send a message in a group chat with @mention → verify response
4. `make trace last replay` → verify trace looks normal (no regressions in payload fields)
