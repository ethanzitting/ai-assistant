# Version 1 — Talking Chatbot

A conversational agent on Digital Ocean that knows your calendar, can set reminders, and holds context across a conversation. Each phase builds on the previous one and produces something testable.

Schema definitions live in [data-architecture.md](../data-architecture.md) and `migrations/`. The event loop implementation lives in `agent/src/engine/`. Event engine design lives in [event-engine.md](../event-engine.md). Setup procedures live in [setup.md](../setup.md). This doc covers the implementation sequence and Version 1-specific decisions — not the architecture itself.

## Phase 1 — Infrastructure & Database

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

## Phase 2 — Anthropic API & Event Loop

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

Implementation: `agent/src/engine/`. Key Version 1 behaviors:

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

Coarse-grained tools for Version 1. Each tool does significant work in application code — the LLM says what, the code figures out how. Implementation: `agent/src/tools/`.

**`query_knowledge`** — search the active knowledge graph. Implementation: `agent/src/knowledge/queryKnowledgeTool.ts`.
- Input: natural language question or structured filter (entity type, name pattern, date range)
- Application code: translates to SQL queries across entities, relationships, and facts tables. Handles temporal filtering (`WHERE valid_until IS NULL` for current state, date-range queries for historical). Does not search the archive index.
- Results are post-processed by a lightweight LLM call (Haiku) to condense and format them into a scannable summary.
- Returns: formatted results (entities with their current facts, relationships) plus a nudge to try different queries and a reminder that archives were not searched. The nudge is always present regardless of result quality.

**`search_archives`** — search the archive index for historical context. *(Not yet implemented — Version 2.)*
- Input: natural language query
- Application code: embeds the query and runs a similarity search against the archive partition of `document_chunks` (permanent embeddings of every conversation, email, document, and note archived to B2).
- Returns: relevant passages from original documents. Used when `query_knowledge` results are insufficient — the LLM decides to call this explicitly, guided by the nudge in `query_knowledge` results.

**`remember`** — store information from the conversation. Implementation: `agent/src/knowledge/rememberTool.ts`.
- Input: structured extraction (entity, fact, relationship, or preference)
- Application code: inserts into the appropriate table. For entities, does fuzzy name matching first and returns candidates if ambiguous — the LLM picks the right one or creates a new entity. Entity resolution logic: `agent/src/knowledge/findExistingEntity.ts`.
- Deduplication: before inserting a fact, checks for an existing current fact (where `valid_until IS NULL`) with the same entity and attribute. If the value is identical, returns "Already known" without writing. If a different value exists, supersedes it by setting `valid_until = now()` on the old fact before inserting the new one. Relationships use the same pattern — identical relationships return "Already known". This prevents the LLM from looping on repeated storage attempts.
- Returns: confirmation of what was stored, updated, or already known

**`manage_events`** — create, update, list, and resolve events and reminders. Implementation: `agent/src/events/manageEventsTool.ts`.
- Input: action (create/update/list/complete/drop) with event details
- Application code: CRUD operations on the events and reminders tables. Handles recurrence logic per [event-engine.md](../event-engine.md). Computes next reminder times.
- Returns: confirmation or list of matching events

**`get_calendar`** — fetch Google Calendar events for a date range. Implementation: `agent/src/tools/calendarTool.ts`.
- Input: start date, end date
- Application code: queries locally synced calendar events from Postgres (no API call per question)
- Returns: formatted list of events with time, title, location

**`fetch_skill`** — load a skill's full body. Implementation: `agent/src/tools/skillTool.ts`.
- Input: skill name
- Application code: `SELECT body FROM skills WHERE name = $1`
- Returns: the skill body text, which the LLM incorporates into its reasoning

**`send_message`** — send a proactive Telegram message. Implementation: `agent/src/telegram/messagingTool.ts`.
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

## Phase 3 — Telegram Bot

Wire up real user input. By the end of this phase, you can text the bot and have a conversation.

### Telegram long polling

Use the [grammY](https://grammy.dev) framework — it runs natively on Deno, supports long polling, and handles message parsing, reply formatting, and error recovery.

Long polling means the bot makes outbound HTTPS requests to Telegram's servers and holds the connection open until a message arrives. No webhooks, no public endpoints.

### Message routing

Telegram text messages → high-priority event in the queue → event loop processes → response sent back via Telegram. Implementation: `agent/src/telegram/createTelegramBot.ts`.

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

The bot instance is initialized once in `main.ts` and shared via a singleton (`agent/src/telegram/sendTelegramMessage.ts`) so both paths use the same bot API connection.

### Chat ID persistence

The bot persists the owner's `chat_id` to the `preferences` table on every incoming message (INSERT ... ON CONFLICT DO NOTHING). This enables proactive messaging — the `send_message` tool looks up the stored chat_id to deliver messages even when no user message triggered the interaction.

### User validation

Single-user system. The `TELEGRAM_OWNER_ID` environment variable (set in `.env.tpl`) contains the owner's Telegram user ID. Messages from other users are rejected and logged. If the variable is not set, all messages are accepted with a warning logged — useful during initial setup to discover your user ID.

### Audio message handling

Extend the Telegram bot to handle voice messages and audio files. When the bot receives audio, it downloads the file, sends it to the Deepgram API for transcription, and processes the transcript as a text message through the normal event loop.

grammY handles voice messages via `bot.on("message:voice")` and audio files via `bot.on("message:audio")`. Telegram provides voice messages as OGG/Opus files and audio files in their original format — Deepgram accepts both.

In Version 1, the agent container calls Deepgram directly (no ingestion container yet). When the ingestion container arrives in Version 2, audio processing moves there with proper isolation. The Deepgram API key is scoped to transcription only — no account management permissions.

**File size limit:** The Telegram Bot API's `getFile` method only supports files up to 20MB. Voice memos recorded in-app are well under this (~1MB/min for OGG/Opus), but uploaded audio files (meeting recordings, podcasts) can exceed it. Version 1 detects oversized files from Telegram's message metadata (available before download) and replies with a helpful message suggesting the user trim or compress the file. Version 2 removes this limit via the Telegram Bot API Local Server — see Phase 7.

```typescript
bot.on("message:voice", async (ctx) => {
  const file = await ctx.getFile();
  const audioBuffer = await downloadFile(file);
  const transcript = await transcribeAudio(audioBuffer);
  queue.push({
    type: "user_message",
    priority: "high",
    payload: { text: transcript, chat_id: ctx.chat.id },
  });
});
```

### Message formatting

Messages are currently sent as plain text. MarkdownV2 formatting is a future enhancement — keep responses concise since this is a mobile chat interface.

### Testable at end of phase

- Send a message to the bot, get a response
- Have a multi-turn conversation that maintains context
- Tell the bot a fact ("My sister's name is Sarah"), then ask about it later ("What's my sister's name?")
- Send a voice memo to the bot → transcript is processed, agent responds to the content
- Send an audio file to the bot → same behavior as voice memo
- Verify rejected messages from other users are logged

---

## Phase 4 — Knowledge Graph Seeding

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

## Phase 5 — Google Calendar

Connect the agent to your real calendar so it knows what your day looks like.

### OAuth flow

See [setup.md](../setup.md) for the full Google OAuth procedure. The `make auth-google` command runs the one-time authorization locally and stores the refresh token in 1Password.

### Calendar sync

A periodic job (every 5 minutes) that:

1. Calls the Google Calendar API for events in a rolling window (today through 14 days out)
2. Upserts events into the `events` table (or a dedicated `calendar_events` table if cleaner)
3. Detects changes: new events, updated times, cancellations

The sync should be efficient — use the Calendar API's `syncToken` or `updatedMin` parameter to fetch only changes since the last sync, not the full calendar every time.

### Calendar data in context

The `get_calendar` tool queries the locally synced events. No API call per user question — the tool reads from Postgres.

### Testable at end of phase

- Calendar events appear in the database after sync
- Ask the agent "What's on my calendar tomorrow?" and get accurate results
- Change an event in Google Calendar, wait 5 minutes, ask again — updated
- Ask "Do I have any conflicts this week?" — agent reasons about overlapping events

---

## Phase 6 — Event Engine

Give the agent the ability to track reminders, deadlines, and recurring tasks. This is the "clock" that makes the agent proactive. Implements the design from [event-engine.md](../event-engine.md).

### Event processing loop

A periodic job (every 60 seconds) that:

1. Queries the `reminders` table for reminders where `remind_at <= now()` and `status = 'pending'`
2. For each due reminder, pushes a normal-priority event into the queue with the reminder context
3. The event loop processes these: the LLM decides how to notify you (Telegram message with appropriate urgency)
4. After delivery, marks the reminder as `sent`

### Recurrence logic

Implements the two recurrence models from [event-engine.md](../event-engine.md): fixed-schedule (calendar-anchored, missed occurrences become unresolved items) and interval-from-completion (timer resets from actual completion date). Implementation: `agent/src/events/computeNextDueAt.ts`.

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

## Phase 7 — Daily Briefing

The morning touchpoint that makes the agent feel alive. Triggered by the event engine, assembled by a skill, delivered via Telegram.

### Briefing skill

The `daily_briefing` skill body contains instructions for what to include and how to format it:

1. Today's calendar events (from synced Google Calendar) with times, locations, and any prep notes
2. Upcoming deadlines within the next 3 days
3. Due reminders and overdue items
4. Pending unresolved events (missed recurring items)
5. Any recent knowledge graph updates worth mentioning

The skill instructs the LLM to be concise — a briefing should be glanceable on a phone screen, not a wall of text.

### Assembly

When the daily briefing event fires, the event loop:

1. Loads the `daily_briefing` skill via `fetch_skill`
2. Calls `get_calendar` for today and the next few days
3. Calls `manage_events` to list pending reminders and overdue items
4. Calls `query_knowledge` for any recent facts (active knowledge graph only — the archive nudge in results is irrelevant for briefings since the LLM already has structured data)
5. The LLM synthesizes these tool results into a formatted briefing
6. Delivers via `send_message`

### Testable at end of phase

- Trigger a briefing manually: "Give me my daily briefing"
- Verify it includes calendar events, reminders, and deadlines
- Verify the scheduled briefing fires at the configured time
- Verify the format is concise and readable on mobile

---

## Phase 8 — Deployment & Backups

Get the system running on a real server so it's always available. See [setup.md](../setup.md) for the full deployment and backup procedures — this section covers only what to verify.

### Digital Ocean setup

1. Provision the droplet (see [infrastructure.md](../infrastructure.md) for specs)
2. Install Docker, Docker Compose, 1Password CLI
3. Configure 1Password service account token scoped to the project vault
4. Clone the repo
5. `make up` — production mode
6. Verify: check logs, send a Telegram message, confirm calendar sync runs

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
