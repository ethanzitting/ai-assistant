# Month 1 — Talking Chatbot

A conversational agent on Digital Ocean that knows your calendar, can set reminders, and holds context across a conversation. Each phase builds on the previous one and produces something testable.

## Phase 1 — Infrastructure & Database

Get a working dev environment with a database and secrets management. Nothing AI-related yet — just the foundation everything else sits on.

### Docker Compose

Two compose files:

- `docker-compose.yml` — base configuration. Postgres with pgvector, core container, shared volumes, networks. 
- `docker-compose.dev.yml` — dev overrides. Source directory mounted into the core container, Deno runs with `--watch` for hot-reloading.

`make dev` starts the dev stack. `make up` starts production-like (no hot-reload).

### Postgres

The `pgvector/pgvector:pg16` image. One database, one schema. Core connects with a role that has SELECT, INSERT, UPDATE on all tables — no DELETE on knowledge graph tables. A separate superuser role exists for migrations and backups.

### Migration system

A `migrations/` directory with numbered SQL files. The Postgres entrypoint runs pending migrations on startup. Each migration is idempotent (uses `IF NOT EXISTS` or equivalent). Never modify a migration after it's been applied — always create a new one.

### Database schema

All tables created via migrations:

**Knowledge graph tables** (from [data-architecture.md](../docs/data-architecture.md)):

```sql
-- entities: people, places, organizations, accounts
CREATE TABLE entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    properties JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    source_ref TEXT
);

-- relationships: directed edges between entities
CREATE TABLE relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_a_id UUID REFERENCES entities(id),
    entity_b_id UUID REFERENCES entities(id),
    type TEXT NOT NULL,
    properties JSONB DEFAULT '{}',
    valid_from TIMESTAMPTZ DEFAULT now(),
    valid_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    source_ref TEXT
);

-- facts: temporal knowledge with validity windows
CREATE TABLE facts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID REFERENCES entities(id),
    attribute TEXT NOT NULL,
    value TEXT NOT NULL,
    valid_from TIMESTAMPTZ DEFAULT now(),
    valid_until TIMESTAMPTZ,
    confidence REAL DEFAULT 1.0,
    source_ref TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

**Event engine tables:**

```sql
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    type TEXT NOT NULL,              -- 'fixed', 'deadline', 'fixed_recurring', 'interval_recurring'
    priority TEXT NOT NULL DEFAULT 'medium',  -- 'high', 'medium', 'low'
    dtstart TIMESTAMPTZ,
    dtend TIMESTAMPTZ,
    deadline TIMESTAMPTZ,
    lead_time_days INTEGER,
    recurrence_rule JSONB,           -- interval, unit, anchor_date, from_completion
    category TEXT,
    status TEXT NOT NULL DEFAULT 'active',  -- 'active', 'completed', 'missed', 'dropped'
    last_completed_at TIMESTAMPTZ,
    properties JSONB DEFAULT '{}',
    entity_id UUID REFERENCES entities(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES events(id),
    remind_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'sent', 'acknowledged'
    created_at TIMESTAMPTZ DEFAULT now()
);
```

**Skills table:**

```sql
CREATE TABLE skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
```

**Preferences:**

```sql
CREATE TABLE preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL UNIQUE,
    value JSONB NOT NULL,
    source TEXT,                      -- 'explicit', 'inferred'
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
```

**Audit log:**

```sql
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action TEXT NOT NULL,
    context JSONB DEFAULT '{}',
    outcome JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);
```

**Conversation log:**

```sql
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role TEXT NOT NULL,               -- 'user', 'assistant', 'system', 'tool_call', 'tool_result'
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);
```

### 1Password integration

All secrets injected via `op run`. The `Makefile` wraps every command that needs secrets:

```makefile
dev:
	op run --env-file=.env.tpl -- docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

The `.env.tpl` file maps 1Password references to environment variable names — no actual secrets on disk. See [setup.md](../docs/setup.md) for the full vault layout.

### Testable at end of phase

- `make dev` starts Postgres and the core container
- `make db` opens a psql shell, all tables exist
- `make migrate` runs cleanly with no errors
- Core container starts, connects to Postgres, logs a health check

---

## Phase 2 — Anthropic API & Core Loop

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

### Core event loop

The loop from [core-loop.md](../docs/core-loop.md):

```
while (true) {
  event = queue.next()          // block until an event arrives
  context = assemble(event)     // build the prompt
  
  while (true) {
    response = await anthropic.call(context)
    
    if (response.has_tool_calls) {
      results = await execute_tools(response.tool_calls)
      new_events = queue.drain_high_priority()
      context.append(results, new_events)
    } else {
      break  // final response, no more tool calls
    }
  }
  
  deliver(response)             // send to Telegram, log, etc.
}
```

Key behaviors:
- Between every tool call, drain high-priority events from the queue and append them as context
- Normal-priority events wait until the current task completes
- Every tool call passes through middleware that checks circuit breakers (stub for Month 1, real implementation Month 2)

### Conversation management

Simplified version of the four-layer context assembly. In Month 1:

- **Stable prefix:** system prompt, tool definitions, skill name/description list, user preferences from the preferences table. Cached via Anthropic prompt caching.
- **Conversation history:** the last N messages, pulled from the conversations table. When the token count exceeds a budget (start with ~20,000 tokens), truncate from the oldest messages. No compaction yet — just truncation.

Every message (user and assistant) is persisted to the `conversations` table for history. Token counting uses a rough heuristic (4 chars per token) or the Anthropic tokenizer if available in Deno.

### Tool definitions

Coarse-grained tools for Month 1. Each tool does significant work in application code — the LLM says what, the code figures out how.

**`query_knowledge`** — search the knowledge graph.
- Input: natural language question or structured filter (entity type, name pattern, date range)
- Application code: translates to SQL queries across entities, relationships, and facts tables. Handles temporal filtering (`WHERE valid_until IS NULL` for current state, date-range queries for historical).
- Returns: formatted results (entities with their current facts, relationships)

**`remember`** — store information from the conversation.
- Input: structured extraction (entity, fact, relationship, or preference)
- Application code: inserts into the appropriate table. For entities, does fuzzy name matching first and returns candidates if ambiguous — the LLM picks the right one or creates a new entity.
- Returns: confirmation of what was stored

**`manage_events`** — create, update, list, and resolve events and reminders.
- Input: action (create/update/list/complete/drop) with event details
- Application code: CRUD operations on the events and reminders tables. Handles recurrence logic (fixed-schedule vs. interval-from-completion). Computes next reminder times.
- Returns: confirmation or list of matching events

**`get_calendar`** — fetch Google Calendar events for a date range.
- Input: start date, end date
- Application code: queries the Google Calendar API (or local cache if recently synced)
- Returns: formatted list of events with time, title, location

**`fetch_skill`** — load a skill's full body.
- Input: skill name
- Application code: `SELECT body FROM skills WHERE name = $1`
- Returns: the skill body text, which the LLM incorporates into its reasoning

**`send_message`** — send a proactive Telegram message.
- Input: message text
- Application code: calls the Telegram bot API to send the message
- Returns: confirmation

### Testable at end of phase

- Hardcode a user message event, watch the LLM process it
- LLM can call `remember` and data appears in the knowledge graph
- LLM can call `query_knowledge` and retrieve what it stored
- Conversation history persists across multiple events
- Prompt caching is working (check token usage — cached input tokens should be cheap)

---

## Phase 3 — Telegram Bot

Wire up real user input. By the end of this phase, you can text the bot and have a conversation.

### Telegram long polling

Use the [grammY](https://grammy.dev) framework — it runs natively on Deno, supports long polling, and handles message parsing, reply formatting, and error recovery.

Long polling means the bot makes outbound HTTPS requests to Telegram's servers and holds the connection open until a message arrives. No webhooks, no public endpoints.

### Message routing

Telegram text messages → high-priority event in the queue → core loop processes → response sent back via Telegram.

```typescript
bot.on("message:text", (ctx) => {
  queue.push({
    type: "user_message",
    priority: "high",
    payload: {
      text: ctx.message.text,
      chat_id: ctx.chat.id,
      from: ctx.from,
    },
  });
});
```

The core loop's `deliver()` function sends the LLM's response back to the originating chat via `bot.api.sendMessage()`.

### User validation

Single-user system. Hardcode your Telegram user ID (or store it as a preference). Reject messages from anyone else — log and ignore.

### Message formatting

Telegram supports Markdown. The LLM's responses should be formatted for Telegram's MarkdownV2 parser. Keep responses concise — this is a mobile chat interface, not a document viewer.

### Testable at end of phase

- Send a message to the bot, get a response
- Have a multi-turn conversation that maintains context
- Tell the bot a fact ("My sister's name is Sarah"), then ask about it later ("What's my sister's name?")
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

### Testable at end of phase

- Ask the agent about a seeded contact: "What's my dentist's phone number?"
- Ask a relationship question: "Who are my siblings?"
- Agent responds according to seeded preferences
- Agent can fetch and use a skill when relevant

---

## Phase 5 — Google Calendar

Connect the agent to your real calendar so it knows what your day looks like.

### OAuth flow

The `make auth-google` command runs a local script that:

1. Opens a browser to Google's consent screen
2. User clicks "Allow"
3. Script receives the authorization code via a localhost redirect
4. Exchanges the code for access + refresh tokens
5. Stores the refresh token in 1Password via `op item edit`

This only runs once (on your laptop, not the server). The application uses the refresh token to get short-lived access tokens automatically.

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

Give the agent the ability to track reminders, deadlines, and recurring tasks. This is the "clock" that makes the agent proactive.

### Event processing loop

A periodic job (every 60 seconds) that:

1. Queries the `reminders` table for reminders where `remind_at <= now()` and `status = 'pending'`
2. For each due reminder, pushes a normal-priority event into the queue with the reminder context
3. The core loop processes these: the LLM decides how to notify you (Telegram message with appropriate urgency)
4. After delivery, marks the reminder as `sent`

### Recurrence logic

When an event is completed or a fixed-schedule recurrence fires:

- **Fixed-schedule:** compute the next occurrence from the recurrence rule (e.g., "every Thursday" → next Thursday). Create the next reminder. A missed occurrence becomes an unresolved item.
- **Interval-from-completion:** when you mark it done, compute the next occurrence from *now* (e.g., "every 90 days" → 90 days from today). Create the next reminder.

### Conversational event creation

The `manage_events` tool lets the LLM create events from natural conversation:

- "Remind me to call the dentist next Tuesday" → fixed event with a reminder
- "I need to change the furnace filter every 90 days" → interval-from-completion recurring event
- "What reminders do I have this week?" → query and format

The LLM parses the intent; the tool handles the database operations and recurrence math.

### Daily briefing trigger

A scheduled event that fires every morning at your preferred briefing time. The event processing loop detects it, pushes it into the queue, and the core loop processes it using the `daily_briefing` skill.

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

When the daily briefing event fires, the core loop:

1. Loads the `daily_briefing` skill via `fetch_skill`
2. Calls `get_calendar` for today and the next few days
3. Calls `manage_events` to list pending reminders and overdue items
4. Calls `query_knowledge` for any recent facts
5. The LLM synthesizes these tool results into a formatted briefing
6. Delivers via `send_message`

### Testable at end of phase

- Trigger a briefing manually: "Give me my daily briefing"
- Verify it includes calendar events, reminders, and deadlines
- Verify the scheduled briefing fires at the configured time
- Verify the format is concise and readable on mobile

---

## Phase 8 — Deployment & Backups

Get the system running on a real server so it's always available.

### Digital Ocean setup

1. Provision the droplet (4 vCPU, 8GB RAM, 80-160GB SSD)
2. Install Docker and Docker Compose
3. Install the 1Password CLI, configure a service account token scoped to the project vault
4. Clone the repo
5. `make up` — production mode
6. Verify: check logs, send a Telegram message, confirm calendar sync runs

Access via DO console SSH for Month 1. WireGuard VPN comes in Month 2.

### Backup scripts

A `backups/backup.sh` script that:

1. Runs `pg_dump` as the Postgres superuser role
2. Compresses with gzip
3. Encrypts with GPG (key ID from 1Password)
4. Uploads to B2 using the write-only application key
5. Records a metrics snapshot (entity count, fact count, event count, file size, SHA256) as a JSON file alongside the backup
6. Compares metrics against the previous backup, alerts via Telegram if counts dropped or file size shrank significantly

Set up a cron job to run daily at a quiet hour.

### Weekly verification script

A `backups/verify.sh` script that:

1. Downloads the most recent backup from B2
2. Decrypts and decompresses
3. Restores to a temporary Docker Postgres container
4. Runs metric queries and compares against the stored snapshot
5. Tears down the temporary container
6. Alerts via Telegram on success or failure

Set up a weekly cron job.

### Testable at end of phase

- `make backup` runs successfully, encrypted backup appears in B2
- Manually restore from backup to a local Postgres, verify data is intact
- Verify the metrics snapshot is accurate
- Kill the droplet, provision a new one, restore from backup — everything works
- Send a Telegram message to the bot on the droplet, get a response
- Daily briefing fires on schedule
