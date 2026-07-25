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
| Knowledge graph | Entities, facts, relationships | `src/knowledge/` |
| Semantic search | Embeddings + hybrid (vector + keyword) retrieval over the KG and archives | `src/embeddings/`, `src/knowledge/hybridSearch.ts` |
| Events | Reminders, deadlines, recurring items | `src/events/` |
| Audio | Voice note transcription (Deepgram nova-2) | `src/audio/` |
| Archive | File storage to Backblaze B2 | `src/archive/` |
| Tracing | Full request/response cycle logging | `src/trace.ts` |
| Retry | Backoff/jitter/timeout wrapper for external API calls | `src/retry/` |
| Maintenance | Dedup/consolidation passes over the KG, re-embedding | `src/maintenance/` |

### Tool definitions

Tools are registered in `src/tools/toolRegistry.ts`. Each tool is a `ToolDefinition` with a JSON schema (what Claude sees) and a handler function. `toolRegistry.ts` also enforces per-turn gates: `remember` and `manage_events` `create` may each be called only once per turn, and a second call is rejected with an error telling Claude to batch instead of retry. Current tools:

- `query_knowledge` — hybrid (semantic + keyword) search over the knowledge graph; returns the facts most relevant to the query, ranked, capped per entity (not the entity's whole record)
- `search_archives` — semantic search over archived file text (voice/audio transcripts, OCR'd photos and documents) stored in `document_chunks`
- `remember` — batch-store items (entities, facts, relationships) with Valibot validation
- `manage_events` — CRUD for reminders and deadlines
- `get_calendar` — placeholder (not yet wired to Google Calendar)
- `send_message` — proactive Telegram message
- `web_search` — Anthropic server-side tool (not client-defined)

### Database

Postgres with pgvector extension. Tables: `entities`, `facts`, `relationships`, `conversations`, `chats`, `events`, `reminders`, `engine_trace`, `archived_files`, `document_chunks`, `audit_log`, `schema_migrations`.

`audit_log` is a leftover from `004_skills_and_config.sql` — nothing in `src/` reads or writes it.

Facts support temporal validity (`valid_from`/`valid_until`) and are auto-superseded when a new value is stored for the same entity+attribute.

`findExistingEntity.ts` does fuzzy name matching for dedup on write. Read-time recall is semantic: `entities` and `facts` carry `embedding vector(1536)` + `embedding_model`, and `document_chunks` holds embedded chunks of archived file text (permanent archive index — no tier/partition; the hot/warm/cold lifecycle store is future work). Embeddings are `gemini-embedding-001` @ 1536 dims (MRL, L2-normalized), compared by cosine distance. Model identity and the relevance cutoff (`DISTANCE_THRESHOLD`, needs tuning against real data) live in `src/embeddings/embeddingModel.ts`; vectors from different models are not comparable, hence the `embedding_model` stamp on every row.

**Migrations apply in filename-sort order** (`scripts/migrate.sh`). Numbers aren't strictly unique historically (two `006_*` files exist); the latest is `014_drop_chat_policies.sql`, so the next is `015`.

## Dev workflow

All secrets are in 1Password and injected at runtime via `op run --env-file=.env.tpl`.

```bash
make dev                  # start all containers with hot-reload (mounts ./src into agent container)
make up                   # start all containers detached (no hot-reload)
make down                 # stop all containers
make logs                 # tail container logs
make db                   # psql shell into Postgres
make migrate              # run pending SQL migrations from migrations/
make test                 # deno test src/tests/
make reembed              # (re)embed any null/stale rows: migration, outage recovery, or model change (in-container)
make backfill-archives    # one-time: populate document_chunks from pre-existing archived files (in-container)
make prune-duplicates     # dry-run report of duplicate facts/relationships (in-container)
make consolidate-facts    # dry-run report of fact clusters to merge (in-container)
make trace                # trace summary (recent traces)
```

**The KG cleanup passes are dry-run by default.** `make prune-duplicates` and `make consolidate-facts` only report; the `-apply` variants (`make prune-duplicates-apply`, `make consolidate-facts-apply`) pass `--apply` and actually mutate the graph. Read the dry-run output before applying.

`make backup` is a stub — it prints "not yet implemented (Phase 8)" and does nothing.

**Hot reload**: dev mode mounts `./src` and `./deno.json` into the container and runs with `deno run --watch`. File edits restart the agent — be careful editing files while Jarvis is mid-processing (the turn will be killed and the Telegram message lost).

**WARNING: Always use `make` commands, never raw `docker compose`.** Secrets are injected via `op run --env-file=.env.tpl` which the Makefile handles. Running `docker compose up` or `docker compose restart` directly bypasses 1Password injection and starts containers with blank env vars — the agent will crash or silently fail on any API call.

**WARNING: `op run` fails closed on unresolved secrets.** Adding a new secret reference to `.env.tpl` breaks *every* `op run` make command (`dev`, `up`, `migrate`, `trace`) until that item actually exists in the `ai.assistant` 1Password vault. Create the secret in 1Password *first*, then add its reference.

**Container-injected env is set at start, not by the watcher.** Adding a new env var means a full `make dev`/`make up` restart to inject it — the hot-reload watcher only reloads code.

**In-container scripts live under `src/`.** The Dockerfile copies only `src/` and `deno.json` into the image, so anything that must run inside the agent container (e.g. Deno backfill scripts in `src/backfill/`, run via `docker compose exec agent deno run …`) belongs under `src/`. `scripts/` is for host-side tooling and takes any executable — shell, Deno, whatever fits the job — since none of it is copied into the image.

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
deno check src/main.ts    # type-check the whole project (backfill scripts aren't in this graph — check them explicitly)
```

**`deno check` is authoritative — ignore IDE "Cannot find module '@/…'" errors.** The IDE/TypeScript server doesn't resolve Deno's `@/` import map, so it shows false module-resolution diagnostics on the absolute imports. If `deno check` passes, the code is fine.

### Inspecting the database non-interactively

`make db` opens an interactive shell. For a one-off read query, exec into the already-running postgres container (its env is set at container start, so no `op run` needed):

```bash
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT …"'
```

## Coding conventions

- Functional style — functions are the primary unit of composition, not classes
- One exported function per file, file named after the export (camelCase)
- Files under ~100 lines; split if larger
- Named exports only, absolute imports (`@/` prefix)
- Descriptive variable names — no abbreviations (`queryVector` not `queryVec`, `queryVectorLiteral` not `qLit`). The only accepted short form is `err` in catch blocks (codebase-wide convention; avoids colliding with the `error` logger).
- Early returns, no deep nesting
- **Make the code self-documenting; treat a comment as a smell.** A comment usually means the code failed to express itself — fix *that* first. Optimize for readability and maintainability: precise names, small single-purpose functions, named constants instead of inline numbers, descriptive literal-union values (`"search-query"`/`"stored-document"`, not `"query"`/`"document"`), and options objects instead of long positional arg lists. A reader (human or LLM) should grasp intent from the code alone. Aim to remove almost all comments. The few that remain should explain *why* the code can't — non-obvious rationale, how an empirical value was derived, or an external gotcha (a library quirk) — never *what* the code does or *how* it does it.
- **Outbound calls to external APIs go through `src/retry/`.** Use `fetchWithRetry(input, init, { timeoutMs })` for raw HTTP (handles backoff, jitter, Retry-After, per-attempt timeouts, and retries 408/425/429/5xx + network/timeout errors; pass `timeoutMs`, never put `AbortSignal.timeout` in `init` — it's reused across attempts and goes stale). Use `withRetry(fn, options)` for non-fetch or stateful operations (e.g. B2 upload, which re-authorizes via `onRetry`). The Anthropic SDK path is the exception — it uses its own SDK-error-aware `src/anthropic/callWithRetry.ts`.
- **Write `jsonb` columns with `db.json(value as never)`, never `${JSON.stringify(value)}`.** postgres.js serializes the value itself; a pre-stringified string gets double-encoded and stored as a JSON *string*, not an object — so `->>'key'` returns null, and any read-modify-write path can snowball it into megabytes (this caused a real 52MB corruption + crash). `trace.ts` is the reference. More broadly: verify a library's serialization/IO behavior with a quick throwaway probe (e.g. a TEMP-table insert) before trusting an assumption — guessing cost real time this session.
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
| `deepresearch.md` | Multi-step research workflow |
| `event-pipeline-cleanup.md` | Event/reminder pipeline rework |
| `workflow-*.md` | Step-by-step traces through realistic use cases (financial, recall, research, medical research, tasks, SMS) |

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
  knowledge/                 # knowledge graph tools, hybrid search, storage
  embeddings/                # Gemini embedding client, chunking, vector helpers
  events/                    # event/reminder CRUD
  audio/                     # Deepgram transcription, Telegram file download
  archive/                   # Backblaze B2 upload, archive embedding + search
  ocr/                       # Mistral OCR
  telegram/                  # grammY bot, voice/photo/document handlers, messaging tool
  prompt/                    # system prompt assembly, token estimation
  tools/                     # tool registry, tool types, tool input parsing, calendar
  retry/                     # withRetry + fetchWithRetry (backoff/jitter/timeout) for external APIs
  maintenance/               # standing in-container commands: reembed, dedup pruning, fact consolidation
  backfill/                  # archives.ts — one-time migration: populate document_chunks (run in-container)
  tests/                     # deno test suite (queue, recurrence, tokens) — run via `make test`
migrations/                  # numbered SQL files applied by scripts/migrate.sh
scripts/                     # host-side tooling, any executable (not copied into the image)
  trace.sh                   # trace debugging CLI
  migrate.sh                 # migration runner
```
