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
- **Allowed group chats:** Messages from ANY member are accepted and processed. The bot sees all messages (privacy mode already disabled in BotFather). Media from any member is transcribed and processed.
- **Trigger mechanism:** In groups, the bot responds to `@botname` mentions or replies to the bot's messages. It sees all messages for context but only actively responds when addressed.
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

### Event payload

Every message pushed to the event queue includes:

```typescript
payload: {
  text: ctx.message.text,
  chat_id: ctx.chat.id,              // telegram chat id (for delivery)
  internal_chat_id: chat.id,         // internal UUID (for context loading)
  chat_type: ctx.chat.type,          // 'private', 'group', 'supergroup'
  sender_name: ctx.from.first_name,  // null for private chats
  sender_id: String(ctx.from.id),    // telegram user id
}
```

## Sender identity and owner distinction

Every message carries `sender_name` (from `ctx.from.first_name`) and `sender_id` (from `ctx.from.id`). The system prompt identifies the owner by `TELEGRAM_OWNER_ID`.

- When the owner says "my sister is Sarah", the agent stores it as a fact about the owner.
- When someone else says "my sister is Sarah", the agent attributes it to that person — Sarah's birthday fact, not the owner's.
- The agent knows who it's talking to on each message and adjusts accordingly.

In group messages, the stored conversation content is prefixed with the sender's name: `[Sarah]: hey can you check...`. This gives the agent clear attribution when assembling context.

## Context assembly

All context loading is scoped by chat:

- `persistMessage(role, content, chatId, metadata)` — adds required `chatId` param
- `loadRecentMessages(chatId, limit)` — filters by `chat_id`
- `assembleContext(chatId, chatType)` — loads per-chat history, injects per-chat policies into the system prompt
- `buildSystemPrompt(chatId, chatType)` — appends group chat addendum and per-chat policies

The token budget and truncation logic stay the same (V1). The only change is that messages loaded are scoped to a single chat. V2's compaction pipeline replaces truncation and operates per-chat.

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
3. `src/conversationHistory.ts` — add chatId param to both functions (breaks all callers)
4. `src/prompt/assembleContext.ts` + `src/prompt/buildSystemPrompt.ts` — chat-scoped context
5. `src/engine/processEvent.ts` — thread internalChatId, sender name prefix
6. `src/engine/handleToolUseResponse.ts` — thread internalChatId through tool loop
7. `src/telegram/createTelegramBot.ts` — group chat logic, ensureChat, mention detection
8. `src/telegram/handleVoiceMessage.ts` — same group chat changes
9. `src/telegram/messagingTool.ts` — optional chat targeting

Steps 3-6 are atomic — the `persistMessage` signature change requires all callers to update together.

## Testable at end of phase

- Message the bot in private and group chat — independent conversation histories
- Knowledge stored from group chat accessible in private chat (unified knowledge graph)
- Another group member sends a message — bot sees it, attributes it correctly
- Another group member sends a voice message — transcribed and processed with their name
- Another group member asks about the owner's private info — bot deflects
- Owner says "my dog's name is Max" in group — stored as owner's fact, retrievable in private chat
- Set a policy on the group chat — agent follows it
- Only the owner can set policies (other members' attempts are rejected)
- Proactive messages (reminders) go to private chat only
- Bot responds to @mentions and replies in groups
