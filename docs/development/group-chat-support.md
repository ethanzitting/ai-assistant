# Group Chat Support

Per-chat conversation isolation with a unified knowledge graph. The agent operates in multiple Telegram chats (private + groups) with independent conversation histories, per-chat behavioral policies, and sender attribution. Anyone in an allowed group can interact with the bot.

> **Motivating use case.** Ethan is adding the bot to a group chat with his mom (Robin) to work together on Dana's medical situation. Dana's information — medical, financial, care logistics — is the shared *subject* of that chat, not private data to guard. The privacy model below is built around that: open by default, with restrictions added explicitly only where a chat needs them.

This is a Version 1 enhancement. It isn't yet slotted into the [version-one.md](version-one.md) phase plan — which currently runs Phase 5 (Event Engine, complete) → Phase 6 (Daily Briefing) → Phase 7 (Deployment & Backups) — but would land after the Event Engine. The database and routing changes are straightforward, and the planned V2 compaction pipeline (see [context-assembly.md](../context-assembly.md)) builds on top of per-chat conversations naturally.

## Design principles

- **Separate contexts, unified knowledge.** Each chat has its own conversation history. The knowledge graph (entities, facts, relationships) is global — knowledge learned in any chat is available everywhere.
- **Owner's assistant, collaborating in a group.** The agent is Ethan's personal assistant that he brings into a group to work *with* the participants — for example, a chat with family to coordinate a relative's medical care. It serves the owner and is openly helpful to everyone the owner has added.
- **Open by default, restrict explicitly.** Per-chat natural-language policies control what the agent discusses. The default posture is open and collaborative: the agent does *not* guard the owner's information, and the subject of a chat (e.g. a family member's medical situation) is not treated as private. When a specific chat needs limits, the owner adds them as explicit policies.
- **Sender attribution (prompt-driven in V1).** Every message carries the sender's name and ID; group messages are stored prefixed `[Name]:`. The agent attributes knowledge by reading that prefix and treats the owner's statements as authoritative. This is LLM-driven, not enforced in code — storing structured provenance (`source_ref` = chat + sender) is a V2 item; the columns exist but stay NULL for now.

## Schema

### Migration: `migrations/010_multi_chat.sql`

> Numbering: `008_conversations_trace_id.sql` and `009_semantic_search.sql` already exist, so the next migration is `010`.

New `chats` table:

```sql
CREATE TABLE IF NOT EXISTS chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_chat_id BIGINT NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 'private',  -- 'private', 'group', 'supergroup'
    name TEXT,
    policies JSONB DEFAULT '[]',
    last_processed_at TIMESTAMPTZ,         -- watermark: chatter extracted up to here
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chats_telegram_id ON chats(telegram_chat_id);
```

Add `chat_id` column to `conversations`:

```sql
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS chat_id UUID REFERENCES chats(id);
CREATE INDEX IF NOT EXISTS idx_conversations_chat_created ON conversations(chat_id, created_at);
```

### Backfill

The migration is three-step:

1. Add the nullable `chat_id` column.
2. Read the existing `telegram_chat_id` from the `preferences` table. If present, create a default private chat row and UPDATE all existing conversation rows to point to it.
3. Add a NOT NULL constraint on `conversations.chat_id` after backfill.

If no `telegram_chat_id` preference exists yet (fresh install), skip the backfill — the column starts nullable and the NOT NULL constraint is enforced going forward once the first chat is created.

## Telegram bot changes

### Access model

- **Private chats:** `TELEGRAM_OWNER_ID` check remains — only the owner can DM the bot. A non-owner DM is dropped **without processing** and surfaced to the owner as a notification (see Chat discovery below).
- **Allowed group chats:** Messages from ANY member in an allowed group are accepted. Privacy mode is disabled in BotFather so the bot sees all messages. The allowlist check runs **before any paid work** — in particular before transcription/OCR — so an unknown chat never costs a Deepgram/Mistral call.
- **Trigger mechanism:** In groups, the bot only responds when @mentioned or replied to. All other messages are deferred and learned from in batches (see "Processing and responding" below).
- **Unknown groups / senders:** Messages from chats not in the allowlist are dropped **without being processed** — the untrusted text never reaches Claude. Jarvis instead notifies the owner with the chat ID and who tried (see Chat discovery below), so the owner can decide whether to allowlist it.

### Environment

New env var:

```
TELEGRAM_ALLOWED_CHATS=402864915,-1001234567890
```

Comma-separated list of allowed Telegram chat IDs (user IDs and group chat IDs). The existing `TELEGRAM_OWNER_ID` remains for private chat gating. If `TELEGRAM_ALLOWED_CHATS` is unset, only the owner's private chat is accepted (current behavior preserved exactly).

### Chat registration

Replace `persistChatId()` with `ensureChat()` that upserts into the `chats` table. New file: `src/telegram/chatRegistry.ts`.

- `ensureChat(chatInfo)` — upsert by `telegram_chat_id`, return the row with internal UUID
- `getPrivateChat()` — return the primary private chat (for proactive messaging)
- `loadChatPolicies(chatId)` — return the policies array for a chat

The `preferences` table row for `telegram_chat_id` is still written for backward compatibility during the transition, but `ensureChat` becomes the primary path.

### Chat discovery & onboarding

Discovery is by **owner notification**, not log-scraping — and it doubles as a prompt-injection boundary. Anything from a source Jarvis doesn't already trust (a group not in `TELEGRAM_ALLOWED_CHATS`, or a DM from a non-owner) is **never processed**: its text never reaches Claude, so a stranger can't smuggle instructions in just by adding the bot to a chat or messaging it. Jarvis extracts only structured metadata and tells the owner.

- **Bot added to a chat** — grammY's `my_chat_member` update fires the moment Jarvis joins, before any message. Code sends the owner a notification — chat title, type, chat ID, and who added it (`from`) — and `ensureChat()`s a pending row.
- **Message from an unknown sender/chat** — dropped without processing. Code sends the owner a one-time notification: "*<name>* (user `<id>`) tried to message me in *<chat title>* (chat ID `<id>`)." Deduped/rate-limited per source so a stranger can't flood you.

The notification is built by code and sent straight to the owner's private chat via `sendTelegramMessage` — it does **not** run an agent turn. The attacker-controlled strings it carries (chat title, sender name) are display-only for the owner; they are never interpolated into Jarvis's prompt as instructions, and a stored `chats.name` is likewise treated as data, not instruction, wherever it's later surfaced. (This is an early, concrete piece of the prompt-injection defense planned for V2 Phase 4: the trust boundary is "is this source allowlisted?", enforced before any text reaches the model.)

Onboarding workflow:

1. You add Jarvis to the new group (or someone new DMs him).
2. Jarvis DMs *you* the chat ID and who did it. Nothing from that source is processed yet.
3. If you trust it, add the chat ID to `TELEGRAM_ALLOWED_CHATS` and `make up`. Only then does Jarvis begin processing and learning from it.

### Processing and responding

Two separate questions: when Jarvis *learns* from a chat, and when he *replies*.

**Learning is deferred and batched — not per message.** Untagged messages are appended to history (`role: 'context'`, sender-prefixed `[Sarah]: going to the store`) for the price of a DB write — no LLM call. The backlog (everything since `chats.last_processed_at`) is extracted in a single pass when either trigger fires:

- **Token limit** — the backlog's estimated size crosses a threshold set comfortably under the conversation truncation budget, so nothing ages out unprocessed. Size is a cheap SQL aggregate over `char_length(content)` using the existing `length / 4` estimate ([tokenEstimation.ts](../../src/prompt/tokenEstimation.ts)) — no LLM call to decide whether to flush.
- **A tag** — Jarvis is @mentioned or replied-to; he processes the backlog *and* replies in the same turn.

> A time-based trigger (flush after N hours) was considered but **deferred for V1**: it needs a periodic scheduler the system doesn't have yet — nothing fires timed events today (the same gap blocks reminders/daily-briefing). Residual risk: a rarely-tagged, low-volume chat won't extract until its next tag or until it crosses the token threshold. Acceptable for the care chat (tagged often); revisit when a scheduler exists.

The flush is a **full turn with `respond: false`**. The flush event's `payload.text` is a standing extraction instruction (e.g. "The conversation history contains unprocessed group messages. Extract all entities, facts, and relationships into the knowledge graph. Do not respond conversationally."). `processEvent` skips persisting this to `conversations` when `respond` is false — it's a system-initiated turn, not a real user message. The backlog is already in history as `context` rows; `assembleContext` loads them normally, so Claude sees the instruction as the current message and the group chatter in context. Whichever trigger fires, Jarvis runs one batched extraction — better dedup and reference resolution than isolated per-message passes — then advances `last_processed_at` to the newest message processed. Only one flush is queued per chat at a time (tracked in-memory via a `Set<chatId>` in the bot handler — lost on restart, which just means a redundant idempotent flush). An idle day costs $0; a busy or finally-addressed chat costs one batched pass, not one per message.

**Replying happens only when addressed** — an @mention or a reply to one of the bot's messages. In a group that's the only thing that posts a message back. In a private chat every message is addressed, so Jarvis both learns and replies immediately (no deferral).

**Addressed-detection logic** — gates whether Jarvis *responds*, not whether he processes — in `createTelegramBot.ts`:

```typescript
function isAddressedToBot(ctx: Context): boolean {
  const msg = ctx.message;
  if (!msg) return false;

  // Reply to bot's message
  if (msg.reply_to_message?.from?.id === ctx.me.id) return true;

  // @mention in text
  const botUsername = ctx.me.username;
  if (botUsername && msg.text?.includes(`@${botUsername}`)) return true;

  // @mention in caption (photos/documents)
  if (botUsername && msg.caption?.includes(`@${botUsername}`)) return true;

  return false;
}
```

**Private chats** skip the addressed-check entirely — every message both teaches Jarvis and gets a reply.

### Event payload

A tagged message enqueues a turn that processes the backlog and replies:

```typescript
payload: {
  text: ctx.message.text,
  chat_id: ctx.chat.id,              // telegram chat id (for delivery)
  internal_chat_id: chat.id,         // internal UUID (for context loading)
  chat_type: ctx.chat.type,          // 'private', 'group', 'supergroup'
  sender_name: senderName(ctx.from), // first + last name (always populated; the [Name]: prefix is omitted for private chats)
  sender_id: String(ctx.from.id),    // telegram user id
  respond: true,                     // tagged → reply
}
```

An untagged message just persists ($0) — no turn — then runs the cheap token/age trigger-check:

```typescript
await persistMessage({
  role: "context",
  content: `[${senderName(ctx.from)}]: ${ctx.message.text}`,
  chatId: internalChatId,
  metadata: { sender_id: String(ctx.from.id) },
});
```

If the token check trips and no flush is already pending for the chat, a flush turn is enqueued with the same payload shape but `respond: false` — process the backlog, send nothing. The `respond` flag is threaded through `processEvent` → `handleToolUseResponse` and guards both send sites; for a flush it overrides the usual "never end a turn in silence" fallback in `deliverFinalResponse`.

Telegram has no single "full name" field — `senderName` composes one from the optional name parts:

```typescript
function senderName(from: User): string {
  return [from.first_name, from.last_name].filter(Boolean).join(" ");
}
```

The composed name is for the human-readable display prefix only. Authoritative identity for knowledge storage keys off the numeric `sender_id` in metadata — names are user-controlled display strings and can change or collide.

## Sender identity and owner distinction

Every message carries `sender_name` (first + last name via `senderName(ctx.from)`) and `sender_id` (from `ctx.from.id`). The system prompt identifies the owner by `TELEGRAM_OWNER_ID`.

- When the owner says "my sister is Sarah", the agent stores it as a fact about the owner.
- When someone else says "my sister is Sarah", the agent attributes it to that person — Sarah's birthday fact, not the owner's.
- The agent knows who it's talking to on each message and adjusts accordingly.

In group messages, the stored conversation content is prefixed with the sender's name: `[Sarah]: hey can you check...`. This gives the agent clear attribution when assembling context. Attribution is therefore the model's judgment from that prefix — the knowledge-storage functions (`storeFact`/`storeEntity`/`storeRelationship`) take no sender parameter in V1.

## Context assembly

All context loading is scoped by chat:

- `persistMessage({ role, content, chatId, metadata, traceId })` — the current signature is already an options object (`{ role, content, metadata?, traceId? }`); this adds a required `chatId` field
- `loadRecentContext(chatId)` — loads the greater of the last 5 responded turns and ~20k tokens, including the interleaved `context` messages
- `assembleContext(chatId, chatType)` — loads per-chat history, injects per-chat policies into the system prompt
- `buildSystemPrompt(chatId, chatType)` — appends group chat addendum and per-chat policies

### Conversation window: greater of 20k tokens and 5 turns

When Jarvis is invoked in a chat, his context window is the **greater of** the last ~20k tokens and the last 5 responded turns — whichever reaches further back. The 5-turn floor guarantees a few full exchanges even when they're long; the 20k floor guarantees ample history when turns are short. A *responded turn* is a message Jarvis replied to, plus that reply and any tool calls between.

- **Private chat:** the last 5 exchanges or ~20k tokens, whichever is larger.
- **Group chat:** the responded turns plus the interleaved `context` messages — the deferred group chatter — that fall within the window, giving Jarvis the surrounding conversation each time he's invoked.

Large attachments in the window can be expensive token-wise. Long-term, attachments will be routed to the knowledge graph immediately instead of living in conversation history. For now the cost is acceptable.

The loader returns all roles including `context`. When assembling the messages array for Claude, `context` messages are mapped to `role: "user"` (the API accepts only user/assistant). **Note:** `assembleContext` today filters to `user`/`assistant` and would silently drop `context` rows — the filter must be widened to include `context` before mapping.

**Role-merging requirement:** Claude's API requires strictly alternating `user`/`assistant` messages. Multiple consecutive `context` rows (or a `context` row followed by a `user` row) all map to `user`, producing consecutive same-role messages that the API rejects. The message-assembly layer must merge consecutive same-role messages into a single message before sending. For now this is a simple concatenation (join with `\n`, preserving each line's `[Name]:` prefix). Longer-term, decoupling the internal conversation model from Claude's role constraints (a proper message-assembly abstraction) would be cleaner — scope that as separate future work, not part of this phase.

The sender prefix (`[Sarah]: ...`) is already in the content, so Claude sees the group thread naturally interleaved with its own replies.

The `handleToolUseResponse` tool loop threads `internalChatId` through so that `assembleContext` and `persistMessage` calls within the loop remain chat-scoped.

**Mid-turn event drain:** `handleToolUseResponse` drains high-priority events from the queue during the tool loop and injects them as context. In multi-chat, this drain must be scoped to the current chat — a message from Chat B must not be injected into Chat A's turn. Filter drained events by `internal_chat_id`; leave non-matching events in the queue.

### Scheduled events

Scheduled events (reminders, daily briefing) don't originate from a specific chat. They fall back to the primary private chat via `getPrivateChat()`. The daily briefing always delivers to the private chat.

## Group chat system prompt addendum

Static text appended to the system prompt for non-private chats:

```
## Group chat context

You are Ethan's personal assistant, brought into a group chat to collaborate with the
participants. Be open and helpful — share information and work through problems together
with the chat. Do not withhold or deflect by default.

- Keep responses concise — you're in a shared space.
- Messages are prefixed with the sender's name: [Sarah]: hey can you check...
- The owner (Ethan) is identified by TELEGRAM_OWNER_ID. Treat the owner's statements as
  authoritative for knowledge storage (facts, preferences). Other participants' statements
  are conversational context — don't store them as owner facts.
- The only limits are the explicit per-chat policies below, if any — follow those strictly.
  Absent a policy, share freely with the chat; do not refuse, hedge, or tell someone to
  "ask the owner directly." The people here were added by the owner to collaborate.
```

## Per-chat policies

### Storage

JSONB array on `chats.policies`:

```json
[
  {
    "rule": "Do not discuss personal finances in this chat.",
    "added_at": "2026-05-29T12:00:00Z"
  },
  {
    "rule": "Keep responses under 3 sentences.",
    "added_at": "2026-05-29T12:00:00Z"
  }
]
```

### What policies are

Natural-language behavioral constraints injected into the system prompt. They guide the LLM's behavior — not code-level enforcement. This is appropriate for V1 because group members are known and trusted (family, friends), not adversarial actors.

### Supported policy types

- **Topic restrictions:** "Do not discuss personal finances in this chat."
- **Privacy boundaries:** "Do not share personal health information."
- **Tone/style:** "Keep responses brief and professional."
- **Behavior:** "Do not send proactive messages to this chat."

### Default policies for new group chats

None — new group chats start open. The owner adds restrictions explicitly only when a chat needs them. (A chat created to coordinate a relative's care, for instance, exists precisely to discuss that person's medical and financial situation freely.)

### Who can set policies

Only the owner, via direct DB update:

```sql
UPDATE chats SET policies = '[{"rule": "...", "added_at": "..."}]'
WHERE telegram_chat_id = -100123456;
```

A conversational policy-setting tool (e.g. "set a policy on this chat") is deferred — it needs a `manage_policies` tool, sender-gating, and multi-chat targeting, none of which exist yet. Direct DB is sufficient for V1's single care chat.

### How policies affect the system prompt

`buildSystemPrompt` loads the policies for the current chat and formats them:

```
## Chat-specific policies

This chat has the following behavioral rules. Follow them strictly:
- Do not discuss personal finances in this chat.
- Keep responses under 3 sentences.
```

## Proactive messaging

The `send_message` tool gains an optional `chat` parameter (chat name) for targeting specific groups. Default: always private chat. The agent never sends proactive messages to groups unless the tool call explicitly specifies the group by name. This is documented in the system prompt.

## Knowledge graph

No changes. Entities, facts, and relationships remain global and unscoped. The agent stores knowledge attributed to the correct person by reading the `[Name]:` prefix (V1 has no code-level sender plumbing or stored provenance — that's a V2 `source_ref` item). Knowledge learned in any chat is available in all chats — the isolation is conversational context only, not data.

## Known limitations & V1 tradeoffs

- **Mention detection** should use Telegram message entities (`mention` / `text_mention`), not a substring match on the username — the `isAddressedToBot` sketch above is illustrative; reading `ctx.message.entities` avoids false positives (quoted usernames) and false negatives (display-name mentions).
- **Proactive targeting** is by internal chat id (or a small owner-defined named set), not a fuzzy chat name — names collide and change.
- **Notification dedup** ("notify the owner once per unknown source") needs stored state — e.g. a `notified_at` on the pending `chats` row — so a stranger can't re-trigger it.
- **Allowlist is env-based** (`TELEGRAM_ALLOWED_CHATS` + `make up` redeploy). Deliberate V1 tradeoff: simpler and harder to tamper with than a DB flag the owner flips conversationally. Revisit if onboarding friction matters.
- **Global knowledge graph** means anything shared in any allowlisted chat enters the shared graph and can surface elsewhere (including other future groups). Fine for a single care chat; needs scoping before multiple unrelated groups.
- **No automated tests** for routing/flush/watermark logic — the Deno harness is pure-function only (no DB/network mocking). Verification is the manual checklist below.
- **Bot API / privacy**: confirm the local Bot API server (`TELEGRAM_API_URL`) delivers group messages and `my_chat_member` updates, and that privacy mode is off in BotFather, before relying on group reception.

## Impact on Version 2

### Phase 1 (Context Assembly & Conversation Memory)

The four-layer prompt design accounts for per-chat conversations:

- **Layer 4 (Raw conversation):** Already per-chat from this phase. Compaction fires per-chat — each chat has its own token budget and compacts independently.
- **Layer 3 (Recent prefix):** Per-chat condensed context. Cross-chat context comes from the knowledge graph (Layers 1-2), not conversation history.
- **Compaction extraction:** Writes to the global knowledge graph regardless of originating chat. Source chat recorded in `source_ref` for provenance.
- **Nightly process:** Runs per-chat: archives each chat's logs separately, trims each chat's recent prefix independently.

### Phase 7 (Telegram Uploads)

File processing results are delivered to the originating chat. The `processing_request` row includes `chat_id` so the agent routes results back correctly.

### Phase 9 (Pruning)

Conversation pruning operates per-chat. A quiet group chat accumulates less and prunes less frequently than an active private chat.

## Implementation order

1. Migration: `010_multi_chat.sql` — chats table, conversations.chat_id, backfill
2. `src/telegram/chatRegistry.ts` — ensureChat, getPrivateChat, loadChatPolicies
3. `src/conversationHistory.ts` — add chatId param, add `context` role support, map `context` → `user` in message assembly, merge consecutive same-role messages
4. `src/prompt/assembleContext.ts` + `src/prompt/buildSystemPrompt.ts` — chat-scoped context
5. `src/engine/processEvent.ts` — thread internalChatId and sender name prefix; skip persisting `payload.text` to conversations when `respond` is false (the flush instruction is system-initiated, not a real user message); on any turn, extract the backlog since `chats.last_processed_at` and advance the watermark to the newest processed message; honor `respond` (false = flush turn, no reply — overrides the always-send fallback in `deliverFinalResponse`).
6. `src/engine/handleToolUseResponse.ts` — thread internalChatId through tool loop; scope mid-turn event drain to the current chat (filter by `internal_chat_id`)
7. `src/telegram/createTelegramBot.ts` — tagged → enqueue a turn (`respond: true`); untagged → persist as `context` + run the token trigger-check (enqueue a flush if it trips); `my_chat_member` + unknown-source handling that notifies the owner with chat ID + sender name (no text processed, deduped per source); group chat routing, ensureChat
8. `src/telegram/handleVoiceMessage.ts`, `handlePhotoMessage.ts`, `handleDocumentMessage.ts` — move the allowlist/trust gate ahead of the transcription/OCR call (today it sits after the `isOwner` check, inside the handler). All allowlisted-group media — any member's — is transcribed/OCR'd on arrival (media can't be deferred like text; you need the text to store it), then its text follows the defer/flush path. A reply is posted only if the bot was @mentioned in the caption.
9. `src/telegram/messagingTool.ts` — optional chat targeting

Steps 3-6 are atomic — the `persistMessage` signature change requires all callers to update together.

## Testable at end of phase

- Message the bot in private and group chat — independent conversation histories
- Knowledge stored from group chat accessible in private chat (unified knowledge graph)
- Group members send messages without @mentioning the bot — no reply; they're appended to history and extracted on the next flush (token trigger) or tag
- @mention the bot after a stretch of untagged messages — bot responds with awareness of the backlog (references prior messages) and extracts it as part of that turn
- Another group member sends a voice message — transcribed and processed with their name
- Another group member asks about Dana's medical situation — bot answers openly (open-by-default posture)
- Owner says "my dog's name is Max" in group — stored as owner's fact, retrievable in private chat
- Set a policy on the group chat — agent follows it
- Only the owner can set policies (other members' attempts are rejected)
- Proactive messages (reminders) go to private chat only
- Bot responds to @mentions and replies in groups, silent otherwise
- Busy group chat — untagged messages accrue at $0 and trigger one batched extraction when the token threshold trips (not one pass per message)
- Non-allowlisted chat sends media — verify NO Deepgram/Mistral call is made (the trust gate precedes transcription)
- Flush turn — verify it sends nothing yet advances `last_processed_at`
