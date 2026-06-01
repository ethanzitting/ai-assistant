# Version 1 — Talking Chatbot

A conversational agent on Digital Ocean that can set reminders, transcribe voice and video messages, and hold context across a conversation. Each phase builds on the previous one and produces something testable.

Schema definitions live in [data-architecture.md](../data-architecture.md) and `migrations/`. The event loop implementation lives in `src/engine/`. Event engine design lives in [event-engine.md](../event-engine.md). Setup procedures live in [setup.md](../setup.md). This doc covers the implementation sequence and Version 1-specific decisions — not the architecture itself. Google Calendar integration is deferred to Version 2.

## Phase 1 — Infrastructure & Database [COMPLETE]

Get a working dev environment with a database and secrets management. Nothing AI-related yet — just the foundation everything else sits on.

### Docker Compose

Two compose files (see [infrastructure.md](../infrastructure.md) for the full dev environment design):

- `docker-compose.yml` — base configuration. Postgres with pgvector, agent container, shared volumes, networks.
- `docker-compose.dev.yml` — dev overrides. Source directory mounted into the agent container, Deno runs with `--watch` for hot-reloading.

`make dev` starts the dev stack. `make up` starts production-like (no hot-reload).

### Postgres

The `pgvector/pgvector:pg16` image. One database, one schema. The agent connects with a role that has SELECT, INSERT, UPDATE on all tables — no DELETE on knowledge graph tables (see [security.md](../security.md), agent container section). A separate superuser role exists for migrations and backups.

### Migration system

A `migrations/` directory with numbered SQL files. The Postgres entrypoint runs pending migrations on startup. Each migration is idempotent (uses `IF NOT EXISTS` or equivalent). See the root [README.md](../../README.md) for migration rules and deployment procedures.

### Database schema

All tables created via migrations. Knowledge graph tables (entities, relationships, facts) defined in `migrations/002_knowledge_graph.sql`. Event engine tables defined in `migrations/003_events.sql`. Skills, preferences, audit log, and conversation tables defined in `migrations/004_skills_and_config.sql`. The `next_due_at` column added in `migrations/005_events_next_due_at.sql`.

### 1Password integration

All secrets injected via `op run` — see [setup.md](../setup.md) for the full vault layout and secret-to-environment-variable mappings.

### Testable at end of phase

- `make dev` starts Postgres and the agent container
- `make db` opens a psql shell, all tables exist
- `make migrate` runs cleanly with no errors
- Agent container starts, connects to Postgres, logs a health check

---

## Phase 2 — Anthropic API & Event Loop [COMPLETE]

Get the agentic loop running. By the end of this phase, you can hardcode a message into the event queue and watch the LLM reason about it and call tools.

### Anthropic SDK integration

Connect to the Anthropic API via the official TypeScript SDK (npm-compatible, works in Deno). Enable prompt caching on the stable prefix — the system prompt and tool definitions should get a cache hit on every turn.

Key implementation details:

- System prompt goes in the first `system` block with `cache_control: { type: "ephemeral" }`
- Track token usage per call for cost monitoring and circuit breaker hooks later
- Handle API errors gracefully: rate limits (retry with backoff), server errors (retry once), auth errors (alert via logs)

### Event queue

An in-memory queue (a simple priority array is fine at this scale). Events have:

```typescript
interface Event {
  id: string;
  type: string;          // 'user_message', 'scheduled', 'emission'
  priority: 'high' | 'normal';
  payload: unknown;
  created_at: Date;
}
```

No database table needed for the queue — it's ephemeral. Events arrive, get processed, and are done. The knowledge graph is where durable state lives.

### Event loop

Implementation: `src/engine/`. Key Version 1 behaviors:

- Between every tool call, drain high-priority events from the queue and append them as context
- Normal-priority events wait until the current task completes
- Every tool call passes through middleware that checks circuit breakers (stubbed in Version 1 — passes all calls through. Real implementation in Version 2)
- The tool loop caps at 15 iterations to prevent infinite loops (e.g., the LLM repeatedly calling the same tool). If hit, the loop breaks and delivers whatever response the LLM has produced so far

### Conversation management

Simplified version of the four-layer context assembly (full implementation in Version 2 — see [context-assembly.md](../context-assembly.md)):

- **Stable prefix:** system prompt, tool definitions, skill name/description list, user preferences from the preferences table. Cached via Anthropic prompt caching.
- **Conversation history:** the last N messages, pulled from the conversations table. When the token count exceeds a budget (start with ~20,000 tokens), truncate from the oldest messages. No compaction yet — just truncation.

Every message (user and assistant) is persisted to the `conversations` table for history. Token counting uses a rough heuristic (4 chars per token) or the Anthropic tokenizer if available in Deno.

### Tool definitions

Coarse-grained tools for Version 1. Each tool does significant work in application code — the LLM says what, the code figures out how. Implementation: `src/tools/`.

**`query_knowledge`** — hybrid (vector + keyword) semantic search over the knowledge graph. Implementation: `src/knowledge/queryKnowledgeTool.ts`, `src/knowledge/hybridSearch.ts`.
- Input: a natural-language question or keywords; optional `entity_type`, `include_historical`, `include_all_facts`.
- Application code: embeds the query (`gemini-embedding-001`), runs vector search over fact and entity embeddings plus a tokenized keyword leg, then returns each matched entity with its query-relevant facts (ranked, capped per entity — `include_all_facts` lifts the cap) and relationships. Temporal filtering via `valid_until IS NULL`.
- Returns: formatted results plus a nudge toward `search_archives` for original documents and transcripts.

**`search_archives`** — semantic search over archived-file text. Implementation: `src/archive/searchArchivesTool.ts`, `src/archive/searchArchives.ts`.
- Input: natural-language query, optional `source_type` filter.
- Application code: embeds the query and runs hybrid search against `document_chunks` — embedded chunks of voice/audio transcripts and OCR'd photos and documents. (A single permanent archive table today; the active/archive partition split is future.)
- Returns: ranked passages with their source file. The LLM calls it explicitly for original content, guided by the nudge in `query_knowledge` results.

**`remember`** — store information from the conversation. Implementation: `src/knowledge/rememberTool.ts`.
- Input: structured extraction (entity, fact, relationship, or preference)
- Application code: inserts into the appropriate table. For entities, does fuzzy name matching first and returns candidates if ambiguous — the LLM picks the right one or creates a new entity. Entity resolution logic: `src/knowledge/findExistingEntity.ts`.
- Deduplication: before inserting a fact, checks for an existing current fact (where `valid_until IS NULL`) with the same entity and attribute. If the value is identical, returns "Already known" without writing. If a different value exists, supersedes it by setting `valid_until = now()` on the old fact before inserting the new one. Relationships use the same pattern — identical relationships return "Already known". This prevents the LLM from looping on repeated storage attempts.
- Returns: confirmation of what was stored, updated, or already known

**`manage_events`** — create, update, list, and resolve events and reminders. Implementation: `src/events/manageEventsTool.ts`.
- Input: action (create/update/list/complete/drop) with event details
- Application code: CRUD operations on the events and reminders tables. Handles recurrence logic per [event-engine.md](../event-engine.md). Computes next reminder times.
- Returns: confirmation or list of matching events

**`get_calendar`** — fetch Google Calendar events for a date range. Implementation: `src/tools/calendarTool.ts`. *(Stub — returns "not configured" until Google Calendar integration in Version 2.)*

**`fetch_skill`** — load a skill's full body. Implementation: `src/tools/skillTool.ts`.
- Input: skill name
- Application code: `SELECT body FROM skills WHERE name = $1`
- Returns: the skill body text, which the LLM incorporates into its reasoning

**`send_message`** — send a proactive Telegram message. Implementation: `src/telegram/messagingTool.ts`.
- Input: message text
- Application code: calls the Telegram bot API to send the message
- Returns: confirmation

### Tests: token budget truncation

Unit test the truncation logic — edge cases where the budget is exactly hit, where a single message exceeds the budget, where all messages fit. A bug here either blows the context window (loud) or silently drops important context (quiet and bad).

### Tests: temporal knowledge graph queries

Unit test the SQL generation for "what's true now" vs "what was true at date X" queries. Edge cases: facts with NULL valid_until, facts that start and end on the same day, overlapping validity windows. Wrong temporal logic means the agent silently gives stale or incorrect facts.

### Testable at end of phase

- Hardcode a user message event, watch the LLM process it
- LLM can call `remember` and data appears in the knowledge graph
- LLM can call `query_knowledge` and retrieve what it stored — results are Haiku-formatted and include the archive nudge
- Pre-fetch teaser appears alongside the user message (knowledge graph manifest with entity names and fact counts)
- Conversation history persists across multiple events
- Prompt caching is working (check token usage — cached input tokens should be cheap)

---

## Phase 3 — Telegram Bot [COMPLETE]

Wire up real user input. By the end of this phase, you can text the bot and have a conversation.

### Telegram long polling

Use the [grammY](https://grammy.dev) framework — it runs natively on Deno, supports long polling, and handles message parsing, reply formatting, and error recovery.

Long polling means the bot makes outbound HTTPS requests to Telegram's servers and holds the connection open until a message arrives. No webhooks, no public endpoints.

### Message routing

Telegram text messages → high-priority event in the queue → event loop processes → response sent back via Telegram. Implementation: `src/telegram/createTelegramBot.ts`.

```typescript
bot.on("message:text", async (ctx) => {
  await persistChatId(ctx.chat.id);
  queue.push({
    type: "user_message",
    priority: "high",
    payload: {
      text: ctx.message.text,
      chat_id: ctx.chat.id,
    },
  });
});
```

Response delivery flows through two paths:

- **Reactive:** `process-event.ts` extracts `chat_id` from the event payload and passes it through the tool loop. The final assistant response is sent back to that chat via `sendTelegramMessage()`.
- **Proactive:** The `send_message` tool retrieves the persisted `chat_id` from the preferences table, enabling the LLM to send messages outside of a direct user interaction (e.g., reminders, briefings).

The bot instance is initialized once in `main.ts` and shared via a singleton (`src/telegram/sendTelegramMessage.ts`) so both paths use the same bot API connection.

### Chat ID persistence

The bot persists the owner's `chat_id` to the `preferences` table on every incoming message (INSERT ... ON CONFLICT DO NOTHING). This enables proactive messaging — the `send_message` tool looks up the stored chat_id to deliver messages even when no user message triggered the interaction.

### User validation

Single-user system. The `TELEGRAM_OWNER_ID` environment variable (set in `.env.tpl`) contains the owner's Telegram user ID. Messages from other users are rejected and logged. If the variable is not set, all messages are accepted with a warning logged — useful during initial setup to discover your user ID.

### Audio & video message handling

The Telegram bot handles voice messages, audio files, videos, and video notes. When the bot receives media, it downloads the file, archives it to Backblaze B2, sends it to the Deepgram API for transcription, archives the transcript as a companion `.txt` in B2, and processes the transcript as a text message through the normal event loop. See [deepgram-audio.md](deepgram-audio.md) for full implementation details.

grammY handles all four types via `bot.on(["message:voice", "message:audio", "message:video", "message:video_note"])`. Deepgram accepts video files directly and extracts audio automatically — no ffmpeg needed. In Version 1, the agent container calls Deepgram and B2 directly (no ingestion container yet). Version 2 moves this to the ingestion container with full isolation.

**Archive-first pattern:** Media is archived to B2 before transcription, so the original is safe even if Deepgram fails. B2 archival is non-fatal — if it fails, transcription proceeds with `archive_id = null`. The companion transcript is also archived to B2 with a `metadata.source_file_id` backlink to the original media row.

**File size limit:** A local Telegram Bot API server (`aiogram/telegram-bot-api`) runs alongside the agent, removing the public API's 20MB `getFile` limit. Files up to 100MB are accepted (a practical ceiling for in-memory processing on the VPS). The local server runs with `TELEGRAM_LOCAL=1`, which returns absolute filesystem paths from `getFile` — the agent reads files directly from a shared Docker volume. Files exceeding 100MB are rejected with a helpful message before download.

### Message formatting

Messages are currently sent as plain text. MarkdownV2 formatting is a future enhancement — keep responses concise since this is a mobile chat interface.

### Testable at end of phase

- Send a message to the bot, get a response
- Have a multi-turn conversation that maintains context
- Tell the bot a fact ("My sister's name is Sarah"), then ask about it later ("What's my sister's name?")
- Send a voice memo to the bot → transcript is processed, agent responds to the content
- Send an audio file to the bot → same behavior as voice memo
- Send a video or video note → audio extracted by Deepgram, transcript processed
- Check B2 bucket: media file and companion transcript `.txt` both archived
- Check `archived_files` table: transcript row backlinks to media row via `metadata.source_file_id`
- Verify rejected messages from other users are logged

---

## Phase 4 — Knowledge Graph Seeding [IN PROGRESS]

Populate the system with real data so the agent has something meaningful to work with. This is a manual but important step — the agent's usefulness is directly proportional to its knowledge.

### Seed contacts

Write a seed script or SQL file that inserts your key relationships:

- Close family (parents, siblings, spouse/partner, children)
- Close friends
- Key professional contacts
- Service providers (doctor, dentist, accountant, contractor)

Each contact is an entity with facts (phone, email, birthday, employer, city) and relationships to you and each other. Use real data — this is the foundation the agent reasons about.

### Seed preferences

Insert initial preferences that shape the agent's behavior:

- Communication style preferences
- Daily briefing time
- Notification preferences (what warrants an interrupt vs. waiting)
- Timezone

### Seed skills

Insert the first skills:

- **daily_briefing** — instructions for assembling and delivering the morning briefing
- **remember_conversation** — guidelines for what to extract from conversation (entities, facts, tasks, preferences) and how to handle ambiguous entities

### Tests: entity matching

Unit test the fuzzy name matching logic in the `remember` tool. Cases: exact match, first-name-only with multiple candidates, email-based matching, no match (should create new entity). This is where silent corruption happens — wrong matches merge two people, missed matches create duplicates.

### Testable at end of phase

- Ask the agent about a seeded contact: "What's my dentist's phone number?"
- Ask a relationship question: "Who are my siblings?"
- Agent responds according to seeded preferences
- Agent can fetch and use a skill when relevant

---

## Phase 5 — Event Engine [COMPLETE]

Give the agent the ability to track reminders, deadlines, and recurring tasks. This is the "clock" that makes the agent proactive. Implements the design from [event-engine.md](../event-engine.md).

### Event processing loop

A periodic job (every 60 seconds) that:

1. Queries the `reminders` table for reminders where `remind_at <= now()` and `status = 'pending'`
2. For each due reminder, pushes a normal-priority event into the queue with the reminder context
3. The event loop processes these: the LLM decides how to notify you (Telegram message with appropriate urgency)
4. After delivery, marks the reminder as `sent`

### Recurrence logic

Implements the two recurrence models from [event-engine.md](../event-engine.md): fixed-schedule (calendar-anchored, missed occurrences become unresolved items) and interval-from-completion (timer resets from actual completion date). Implementation: `src/events/computeNextDueAt.ts`.

### Conversational event creation

The `manage_events` tool lets the LLM create events from natural conversation:

- "Remind me to call the dentist next Tuesday" → fixed event with a reminder
- "I need to change the furnace filter every 90 days" → interval-from-completion recurring event
- "What reminders do I have this week?" → query and format

The LLM parses the intent; the tool handles the database operations and recurrence math.

### Daily briefing trigger

A scheduled event that fires every morning at your preferred briefing time. The event processing loop detects it, pushes it into the queue, and the event loop processes it using the `daily_briefing` skill.

### Tests: recurrence logic

Unit test the next-occurrence computation for both recurrence models. Cases: normal next occurrence, missed occurrence (what happens to the schedule), month-end boundaries (Jan 31 → "every month" → Feb 28?), timezone transitions (DST), interval-from-completion with late completion. This is pure logic with many edge cases — a bug means missed reminders you never find out about.

### Testable at end of phase

- "Remind me to buy groceries tomorrow at 5pm" → reminder fires at 5pm, Telegram notification arrives
- "Remind me to water the plants every 2 weeks" → recurring reminder, verify next occurrence after completing
- Create a high-priority reminder → verify it escalates (repeated notification until acknowledged)
- "What are my upcoming reminders?" → formatted list

---

## Phase 6 — Daily Briefing [PLANNED]

The morning touchpoint that makes the agent feel alive. Triggered by the event engine, assembled by a skill, delivered via Telegram.

### Briefing skill

The `daily_briefing` skill body contains instructions for what to include and how to format it:

1. Upcoming deadlines within the next 3 days
2. Due reminders and overdue items
3. Pending unresolved events (missed recurring items)
4. Any recent knowledge graph updates worth mentioning
5. Today's calendar events *(available after Google Calendar integration in Version 2)*

The skill instructs the LLM to be concise — a briefing should be glanceable on a phone screen, not a wall of text.

### Assembly

When the daily briefing event fires, the event loop:

1. Loads the `daily_briefing` skill via `fetch_skill`
2. Calls `manage_events` to list pending reminders and overdue items
3. Calls `query_knowledge` for any recent facts (active knowledge graph only — the archive nudge in results is irrelevant for briefings since the LLM already has structured data)
4. The LLM synthesizes these tool results into a formatted briefing
5. Delivers via `send_message`

### Testable at end of phase

- Trigger a briefing manually: "Give me my daily briefing"
- Verify it includes reminders and deadlines
- Verify the scheduled briefing fires at the configured time
- Verify the format is concise and readable on mobile

---

## Phase 7 — Deployment & Backups [PLANNED]

Get the system running on a real server so it's always available. See [setup.md](../setup.md) for the full deployment and backup procedures — this section covers only what to verify.

### Digital Ocean setup

1. Provision the droplet (see [infrastructure.md](../infrastructure.md) for specs)
2. Install Docker, Docker Compose, 1Password CLI
3. Configure 1Password service account token scoped to the project vault
4. Clone the repo
5. `make up` — production mode
6. Verify: check logs, send a Telegram message, confirm event engine runs

Access via DO console SSH for Version 1. WireGuard VPN comes in Version 2.

### Backup and verification scripts

Implement the backup procedure from [setup.md](../setup.md): daily `pg_dump` → gzip → GPG → B2 with metrics snapshots, weekly restore-to-container verification.

### Testable at end of phase

- `make backup` runs successfully, encrypted backup appears in B2
- Manually restore from backup to a local Postgres, verify data is intact
- Verify the metrics snapshot is accurate
- Kill the droplet, provision a new one, restore from backup — everything works
- Send a Telegram message to the bot on the droplet, get a response
- Daily briefing fires on schedule
