# Jarvis — Personal AI Assistant

Single-user AI assistant that runs as a Telegram bot backed by Claude (claude-opus-4-6). Built in Deno/TypeScript, deployed with Docker Compose, using Postgres for all persistence.

## Architecture

```
Telegram → grammY bot → EventQueue → processEvent → Claude API → tool loop → response
```

- **Single-threaded event loop**: messages queue up, process one at a time
- **Tool loop**: Claude can call tools up to 50 iterations per turn (MAX_TOOL_ITERATIONS in handleToolUseResponse.ts)
- **Conversation history**: stored in `conversations` table, truncated to ~20k tokens per turn (assembleContext.ts)
- **Prompt caching**: system prompt and tool definitions use Anthropic ephemeral cache control

### Key subsystems

| Subsystem | Purpose | Entry point |
|-----------|---------|-------------|
| Knowledge graph | Entities, facts, relationships, preferences | `src/knowledge/` |
| Events | Reminders, deadlines, recurring items | `src/events/` |
| Audio | Voice note transcription (Deepgram nova-2) | `src/audio/` |
| Archive | File storage to Backblaze B2 | `src/archive/` |
| Tracing | Full request/response cycle logging | `src/trace.ts` |
| Skills | Loadable instruction sets for complex tasks | `src/tools/skillTool.ts` |

### Tool definitions

Tools are registered in `src/tools/toolRegistry.ts`. Each tool is a `ToolDefinition` with a JSON schema (what Claude sees) and a handler function. Current tools:

- `query_knowledge` — search entities, facts, relationships
- `remember` — batch-store items (entities, facts, relationships, preferences) with Valibot validation
- `manage_events` — CRUD for reminders and deadlines
- `get_calendar` — placeholder (not yet wired to Google Calendar)
- `fetch_skill` — load skill instructions by name
- `send_message` — proactive Telegram message
- `web_search` — Anthropic server-side tool (not client-defined)

### Database

Postgres with pgvector extension. Tables: `entities`, `facts`, `relationships`, `preferences`, `conversations`, `events`, `skills`, `engine_trace`, `archived_files`, `schema_migrations`.

Facts support temporal validity (`valid_from`/`valid_until`) and are auto-superseded when a new value is stored for the same entity+attribute.

Entity search uses fuzzy name matching via `findExistingEntity.ts`.

## Dev workflow

All secrets are in 1Password and injected at runtime via `op run --env-file=.env.tpl`.

```bash
make dev        # start all containers with hot-reload (mounts ./src into agent container)
make logs       # tail container logs
make db         # psql shell into Postgres
make migrate    # run pending SQL migrations from migrations/
make trace      # trace summary (recent traces)
```

**Hot reload**: dev mode mounts `./src` and `./deno.json` into the container and runs with `deno run --watch`. File edits restart the agent — be careful editing files while Jarvis is mid-processing (the turn will be killed and the Telegram message lost).

### Trace script

The trace script (`scripts/trace.sh`) is the primary debugging tool. Usage:

```bash
make trace                    # list recent traces (default 10)
make trace 20                 # list recent 20 traces
make trace <trace-id>         # step-by-step detail for a trace
make trace <trace-id> replay  # formatted replay (user message, tools, response)
make trace <trace-id> tools   # full tool input/output for a trace
make trace last               # shortcut for most recent trace
make trace last replay        # replay most recent trace
make trace errors             # recent tool errors across all traces
make trace cost               # token usage per trace
make trace search <text>      # search messages/responses by text
```

### Type checking

```bash
deno check src/main.ts    # type-check the whole project
```

## Coding conventions

- Functional style — functions are the primary unit of composition, not classes
- One exported function per file, file named after the export (camelCase)
- Files under ~100 lines; split if larger
- Named exports only, absolute imports (`@/` prefix)
- Early returns, no deep nesting
- Conventional commits: `type(scope): description`

## Documentation

The `docs/` directory contains architecture docs and development plans. Read these before making design decisions — they capture constraints and rationale that aren't obvious from the code.

### Architecture (docs/)

| Doc | Covers |
|-----|--------|
| `vision.md` | What we're building, principles, scope |
| `primitives.md` | The 7 composable primitives the system is built on |
| `data-architecture.md` | Storage layers, schema design, where data lives |
| `data-lifecycle.md` | How data ages — ingestion → compaction → knowledge graph |
| `context-assembly.md` | How the prompt is built from knowledge + conversation history |
| `event-engine.md` | Scheduling, reminders, recurring tasks |
| `ingestion.md` | What data comes in, from where, and how |
| `interfaces.md` | Telegram, smartwatch, AirPods — communication channels |
| `infrastructure.md` | Server setup, costs, deployment |
| `security.md` | Threat model, container isolation, credential handling |
| `trust-model.md` | Phased autonomy — how capabilities expand over time |
| `setup.md` | Full setup/recovery guide |
| `landscape.md` | Competitive landscape — why build vs buy |

### Development plans (docs/development/)

| Doc | Covers |
|-----|--------|
| `roadmap.md` | Phased implementation plan |
| `version-one.md` | V1 scope — conversational chatbot (current) |
| `version-two.md` | V2 scope — memory, email, security |
| `group-chat-support.md` | Multi-chat isolation with shared knowledge graph |
| `imageocr.md` | Mistral OCR for photos and documents |
| `workflow-*.md` | Step-by-step traces through realistic use cases (financial, recall, research, tasks, SMS) |

When working on a feature or debugging behavior, check the relevant architecture doc first — the answer is often already documented.

## File layout

```
src/
  main.ts                    # entrypoint — health check, bot start, event loop
  db.ts                      # Postgres connection (postgres.js)
  trace.ts                   # trace(traceId, step, detail) → engine_trace table
  logger.ts                  # structured logging
  conversationHistory.ts     # persist/load conversation messages
  anthropic/                 # Claude API client, retry logic
  engine/                    # event queue, processing loop, tool execution
  knowledge/                 # knowledge graph tools and storage
  events/                    # event/reminder CRUD
  audio/                     # Deepgram transcription, Telegram file download
  archive/                   # Backblaze B2 upload
  telegram/                  # grammY bot, voice handler, messaging tool
  prompt/                    # system prompt assembly, token estimation
  tools/                     # tool registry, tool types, calendar, skills
migrations/                  # numbered SQL files applied by scripts/migrate.sh
scripts/
  trace.sh                   # trace debugging CLI
  migrate.sh                 # migration runner
```
