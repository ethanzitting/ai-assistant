# Group Chat Support

Per-chat conversation isolation with a unified knowledge graph. The agent operates in multiple Telegram chats (private + groups) with independent conversation histories, per-chat behavioral policies, and sender attribution. Anyone in an allowed group can interact with the bot.

This is a Version 1 phase — slots between Phase 5 (Event Engine) and the current Phase 6 (Daily Briefing, renumbered to 7). The database and routing changes are straightforward, and the existing V2 compaction pipeline (see [context-assembly.md](../context-assembly.md)) builds on top of per-chat conversations naturally.

## Design principles

- **Separate contexts, unified knowledge.** Each chat has its own conversation history. The knowledge graph (entities, facts, relationships) is global — knowledge learned in any chat is available everywhere.
- **Owner's assistant in a group.** The agent is Ethan's personal assistant that happens to be present in a group, not a shared assistant for everyone. It serves the owner primarily but can be helpful to other participants.
- **Per-chat policies.** Natural-language behavioral constraints control what the agent can discuss in each chat. Default posture: protect the owner's private information.
- **Sender attribution.** Every message carries the sender's name and ID. The agent knows who said what and treats the owner's statements as authoritative for knowledge storage.

## Schema

### Migration: `migrations/008_multi_chat.sql`

New `chats` table:

```sql
CREATE TABLE IF NOT EXISTS chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_chat_id BIGINT NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 'private',  -- 'private', 'group', 'supergroup'
    name TEXT,
    policies JSONB DEFAULT '[]',
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

The migration is two-step:

1. Add the nullable `chat_id` column.
2. Read the existing `telegram_chat_id` from the `preferences` table. If present, create a default private chat row and UPDATE all existing conversation rows to point to it.
3. Add a NOT NULL constraint on `conversations.chat_id` after backfill.

If no `telegram_chat_id` preference exists yet (fresh install), skip the backfill — the column starts nullable and the NOT NULL constraint is enforced going forward once the first chat is created.

## Telegram bot changes

### Access model

- **Private chats:** `TELEGRAM_OWNER_ID` check remains — only the owner can DM the bot.
- **Allowed group chats:** Messages from ANY member in an allowed group are accepted. Privacy mode is disabled in BotFather so the bot sees all messages.
- **Trigger mechanism:** In groups, the bot only responds when @mentioned or replied to. All other messages are passively ingested for context (see "Passive vs active messages" below).
- **Unknown groups:** Messages from groups not in the allowlist are silently dropped.

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

### Passive vs active messages

Group messages split into two paths based on whether the bot was addressed:

**Active messages** — the bot was @mentioned or the message is a reply to the bot's message. These are pushed to the event queue as `user_message` events, trigger a full Claude turn (context assembly → Claude API → tool loop → response), and cost a normal API call.

**Passive messages** — everything else in an allowed group chat. These are persisted directly to the `conversations` table with `role: 'context'` and sender attribution (`[Sarah]: going to the store`). No event is queued, no Claude call is made. Cost: one DB write, $0 in API spend.

Passive messages appear in conversation history when Jarvis is next invoked in that chat. He sees what was said and can reference it, extract knowledge from it, or ignore it — but only when he's actually addressed. This means an active group chat with 50 messages/day doesn't burn 50 Claude turns. It burns however many @mentions there are, and those turns have full conversational context.

**Detection logic** in `createTelegramBot.ts`:

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

**Private chats** skip this check entirely — every message is active.

### Event payload

Active messages are pushed to the event queue:

```typescript
payload: {
  text: ctx.message.text,
  chat_id: ctx.chat.id,              // telegram chat id (for delivery)
  internal_chat_id: chat.id,         // internal UUID (for context loading)
  chat_type: ctx.chat.type,          // 'private', 'group', 'supergroup'
  sender_name: senderName(ctx.from), // first + last name, null for private chats
  sender_id: String(ctx.from.id),    // telegram user id
}
```

Passive messages bypass the queue and are written directly:

```typescript
await persistMessage({
  role: "context",
  content: `[${senderName(ctx.from)}]: ${ctx.message.text}`,
  chatId: internalChatId,
  metadata: { sender_id: String(ctx.from.id) },
});
```

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

In group messages, the stored conversation content is prefixed with the sender's name: `[Sarah]: hey can you check...`. This gives the agent clear attribution when assembling context.

## Context assembly

All context loading is scoped by chat:

- `persistMessage(role, content, chatId, metadata)` — adds required `chatId` param
- `loadRecentTurns(chatId, turnCount)` — loads the last N active turns plus interleaved passive messages
- `assembleContext(chatId, chatType)` — loads per-chat history, injects per-chat policies into the system prompt
- `buildSystemPrompt(chatId, chatType)` — appends group chat addendum and per-chat policies

### Conversation window: last 5 active turns

Context is the last 5 active turns, not a token budget. An active turn is a user message that triggered a Claude response (plus the assistant response and any tool calls in between).

- **Private chat:** Last 5 user messages + 5 assistant responses + tool calls = the last 5 back-and-forth exchanges.
- **Group chat:** Last 5 @mentions/replies that Jarvis responded to, plus all passive `context` messages that fall between those turns. This gives Jarvis the surrounding group conversation each time he was invoked.

This replaces the current ~20k token truncation with a simpler, more predictable window. Token count varies — 5 turns of short text is ~2k tokens, 5 turns with large OCR attachments could be 15k+ — but the window is always anchored on meaningful interactions, not an arbitrary byte limit.

Large attachments in the conversation window can be expensive token-wise. Long-term, attachments will be routed to the knowledge graph immediately instead of living in conversation history. For now, the cost is acceptable — 5 turns is a small enough window that even with attachments, context stays manageable.

`loadRecentTurns` returns all roles including `context`. When assembling the messages array for Claude, `context` messages are mapped to `role: "user"` (Claude's API only accepts user/assistant). The sender prefix (`[Sarah]: ...`) is already in the content, so Claude sees the full group conversation thread naturally interleaved with its own responses.

The `handleToolUseResponse` tool loop threads `internalChatId` through so that `assembleContext` and `persistMessage` calls within the loop remain chat-scoped.

### Scheduled events

Scheduled events (reminders, daily briefing) don't originate from a specific chat. They fall back to the primary private chat via `getPrivateChat()`. The daily briefing always delivers to the private chat.

## Group chat system prompt addendum

Static text appended to the system prompt for non-private chats:

```
## Group chat context

You are Ethan's personal assistant, present in a group chat. You serve Ethan primarily
but can be helpful to other participants.

- Keep responses concise — you're in a shared space.
- Messages are prefixed with the sender's name: [Sarah]: hey can you check...
- The owner (Ethan) is identified by TELEGRAM_OWNER_ID. Treat the owner's statements as
  authoritative for knowledge storage (facts, preferences). Treat other participants'
  statements as conversational context — don't store them as owner facts.
- Follow per-chat policies strictly. Default: don't share the owner's personal/private
  information with the group unless the owner explicitly brings it up or a policy allows it.
- If someone asks something that requires the owner's private data, deflect gracefully or
  suggest they ask the owner directly.
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

Don't share personal health, financial, or relationship details unless the owner brings them up.

### Who can set policies

Only the owner. Enforced by checking `sender_id` against `TELEGRAM_OWNER_ID` in the policy-setting logic. The owner can set policies conversationally from any chat or via direct DB update.

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

No changes. Entities, facts, and relationships remain global and unscoped. The agent stores knowledge attributed to the correct person based on sender identity. Knowledge learned in any chat is available in all chats — the isolation is conversational context only, not data.

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

1. Migration: `008_multi_chat.sql` — chats table, conversations.chat_id, backfill
2. `src/telegram/chatRegistry.ts` — ensureChat, getPrivateChat, loadChatPolicies
3. `src/conversationHistory.ts` — add chatId param, add `context` role support, map `context` → `user` in message assembly
4. `src/prompt/assembleContext.ts` + `src/prompt/buildSystemPrompt.ts` — chat-scoped context
5. `src/engine/processEvent.ts` — thread internalChatId, sender name prefix
6. `src/engine/handleToolUseResponse.ts` — thread internalChatId through tool loop
7. `src/telegram/createTelegramBot.ts` — `isAddressedToBot()` detection, passive message persistence, group chat routing, ensureChat
8. `src/telegram/handleVoiceMessage.ts`, `handlePhotoMessage.ts`, `handleDocumentMessage.ts` — same group chat changes (media from any member is processed, but only triggers a Claude turn if the bot was @mentioned in the caption)
9. `src/telegram/messagingTool.ts` — optional chat targeting

Steps 3-6 are atomic — the `persistMessage` signature change requires all callers to update together.

## Testable at end of phase

- Message the bot in private and group chat — independent conversation histories
- Knowledge stored from group chat accessible in private chat (unified knowledge graph)
- Group members send messages without @mentioning the bot — no response, no API call, but messages appear in conversation history
- @mention the bot after passive messages — bot responds with awareness of what was said (references prior messages in its reply)
- Another group member sends a voice message — transcribed and processed with their name
- Another group member asks about the owner's private info — bot deflects
- Owner says "my dog's name is Max" in group — stored as owner's fact, retrievable in private chat
- Set a policy on the group chat — agent follows it
- Only the owner can set policies (other members' attempts are rejected)
- Proactive messages (reminders) go to private chat only
- Bot responds to @mentions and replies in groups, silent otherwise
- Active group chat with many messages — verify no Claude API calls for non-addressed messages
