# Jarvis — Personal AI Assistant

Single-user AI assistant that runs as a Telegram bot through the
provider-neutral Vercel AI SDK. Fireworks AI is the current model provider.
Built in Deno/TypeScript, deployed with Docker Compose, using Postgres for all
persistence.

## Architecture

```
Telegram → grammY bot → EventQueue → processEvent → Vercel AI SDK → Fireworks AI → tool loop → response
scheduler tick → claim due scheduled_jobs → run handler as plain code → job_runs
```

- **Single-threaded event loop**: messages queue up, process one at a time
- **Scheduler runs beside the event loop**: `startScheduler(queue)` ticks every
  60s and calls job handlers directly. A job is either interval-based
  (`interval_seconds`) or daily at a wall-clock time (`daily_at_local_time` +
  `timezone`); the daily case is computed by the `next_daily_run` SQL function
  inside the same atomic claim, so it neither drifts nor needs DST arithmetic of
  ours. Scheduled work is deterministic code, so it does not spend a model turn.
  A handler that genuinely needs judgment (a contextual response) pushes a queue
  event instead of answering for itself. Reminder delivery is deterministic and
  polls once a minute; the 8:00 AM reminder digest enters the event queue for
  model-written context.
- **Tool loop**: the model can call tools up to 50 iterations per turn
  (`MAX_TOOL_ITERATIONS` in `handleToolUseResponse.ts`)
- **Conversation history**: stored in `conversations` table, truncated to ~20k
  tokens per turn (assembleContext.ts)
- **Model routing**: hardcoded task-specific models live in `src/ai/models.ts`;
  the main model is GLM-5.3, with cheaper Fireworks models for vision,
  consolidation, and filenames. Fireworks calls use the US endpoint.

### Key subsystems

| Subsystem       | Purpose                                                                   | Entry point                                        |
| --------------- | ------------------------------------------------------------------------- | -------------------------------------------------- |
| Knowledge graph | Entities, facts, relationships                                            | `src/knowledge/`                                   |
| Semantic search | Embeddings + hybrid (vector + keyword) retrieval over the KG and archives | `src/embeddings/`, `src/knowledge/hybridSearch.ts` |
| Events          | Reminder occurrences, delivery, deadlines, recurring items                | `src/events/`                                      |
| Audio           | Voice note transcription (Deepgram nova-2)                                | `src/audio/`                                       |
| Vision          | Describes photos at ingest so charts are searchable by content            | `src/vision/`                                      |
| Archive         | File storage to Backblaze B2                                              | `src/archive/`                                     |
| Scheduler       | Runs jobs on a clock, beside the event loop                               | `src/scheduler/`                                   |
| Finance         | Plaid ingest, spending queries, and interactive categorization            | `src/plaid/`, `src/finance/`                       |
| Tracing         | Full request/response cycle logging                                       | `src/trace.ts`                                     |
| Retry           | Backoff/jitter/timeout wrapper for external API calls                     | `src/retry/`                                       |
| Maintenance     | Dedup/consolidation passes over the KG, re-embedding                      | `src/maintenance/`                                 |

### Tool definitions

Tools are registered in `src/tools/toolRegistry.ts`. Each tool is a
`ToolDefinition` with a JSON schema (what the model sees) and a handler
function. Handlers receive `(input, traceId, telegramChatId?)` — the third
argument is the chat the current turn came from, so a tool that sends something
replies where it was asked instead of defaulting to the owner's private chat.
`toolRegistry.ts` also enforces per-turn gates: `remember` and `manage_events`
`create` may each be called only once per turn, and a second call is rejected
with an error telling the model to batch instead of retry. Current tools:

- `query_knowledge` — hybrid (semantic + keyword) search over the knowledge
  graph; returns the facts most relevant to the query, ranked, capped per entity
  (not the entity's whole record)
- `search_archives` — semantic search over archived file text (voice/audio
  transcripts, OCR'd photos and documents) stored in `document_chunks`; marks
  image hits as "sendable image"
- `send_image` — send an archived photo back to the user, by `archived_file_id`
  from a `search_archives` hit
- `remember` — batch-store items (entities, facts, relationships) with Valibot
  validation
- `manage_events` — create/update/list reminders, resolve one occurrence, or
  delete a series
- `get_calendar` — placeholder (not yet wired to Google Calendar)
- `query_finances` — spending, balances, and transaction search over the Plaid
  tables; the tool does the arithmetic and returns computed totals so the model
  never re-adds them. Private chat only
- `set_category_rule` — correct a category; writes a `category_rules` row **and
  replays it over matching history**, so past totals change. Private chat only
- `split_transaction` — divide one charge across categories, optionally per
  person; parts must sum to the charge exactly. Private chat only
- `apply_categorization_batch` — apply clear category answers to the numbered
  finance batch in the user's replied message. Private chat only
- `manage_finance_audit` — start, inspect, continue, or cancel a date-range
  cleanup of posted `Unsorted` expenses. Private chat only
- `list_pending_categorizations` — list charges awaiting a category outside a
  finance batch. Private chat only
- `set_vendor_policy` — `auto` files a merchant silently, `ask` queues every
  charge for the nightly question. Private chat only
- `record_receipt` — store a receipt photo and find one exact Plaid charge;
  never confirms a match. Private chat only
- `list_receipt_matches` / `confirm_receipt_match` — review and confirm a
  receipt match after the user gives explicit approval. `get_receipt_content`
  returns the archived OCR before a delayed receipt informs a split. Private
  chat only
- `send_message` — proactive Telegram message

### Database

Postgres with pgvector extension. Tables: `entities`, `facts`, `relationships`,
`conversations`, `chats`, `events`, `event_occurrences`, `reminders`,
`engine_trace`, `archived_files`, `document_chunks`, `audit_log`,
`schema_migrations`, `scheduled_jobs`, `job_runs`, `plaid_items`, `accounts`,
`transactions`, `category_rules`, `categories`, `people`, `transaction_splits`,
`categorization_batches`, `categorization_batch_items`, `transaction_receipts`,
`finance_audits`, `finance_audit_items`, `transaction_category_changes`, plus
the `transaction_categories` view.

`audit_log` is a leftover from `004_skills_and_config.sql` — nothing in `src/`
reads or writes it.

**`archived_files` is the source of truth for re-indexing.** It carries
`telegram_file_id` (re-send a file to Telegram with no bytes — no B2 download,
no local cache), plus `ocr_text`, `ocr_model`, `vision_description`, and
`vision_model`. **The model stamps are what make re-indexing safe**, exactly
like `embedding_model`: a null `ocr_text` _with_ `ocr_model` set means OCR ran
and the image genuinely had no text, while both null means OCR never succeeded
and the row is still owed a retry. `make reindex-photos` gates each unit of work
on its own stamp, so it heals a stale vision model, an unrun OCR, or a photo
left chunkless by an interrupted run — and costs nothing when everything is
current. `document_chunks` holds the _composed_ text (description + OCR), so
recomposing from a chunk would fold the description back into the OCR on every
pass — read the columns, never the chunk. `photoEmbeddingText` in
`src/embeddings/embeddingText.ts` is the single composer, shared by the ingest
and reindex paths.

**Mistral OCR cannot read plotted charts.** It renders the plot area as an
`![img-0.jpeg]` placeholder, so a chart OCRs to little more than its title (one
real chart landed at 122 chars). Data _tables_ survive intact. This is why
photos get a vision description at ingest — it is what makes a graph findable by
what it shows.

Facts support temporal validity (`valid_from`/`valid_until`) and are
auto-superseded when a new value is stored for the same entity+attribute.

`findExistingEntity.ts` does fuzzy name matching for dedup on write. Read-time
recall is semantic: `entities` and `facts` carry `embedding vector(1536)` +
`embedding_model`, and `document_chunks` holds embedded chunks of archived file
text (permanent archive index — no tier/partition; the hot/warm/cold lifecycle
store is future work). Embeddings are `gemini-embedding-001` @ 1536 dims (MRL,
L2-normalized), compared by cosine distance. Model identity and the relevance
cutoff (`DISTANCE_THRESHOLD`, needs tuning against real data) live in
`src/embeddings/embeddingModel.ts`; vectors from different models are not
comparable, hence the `embedding_model` stamp on every row.

**Plaid data is read-only by construction, and that is enforced in three
places.** Plaid issues no scoped API keys — one `client_id`/`secret` pair
reaches every endpoint the account is enabled for. So: (1) no money-movement
product (Transfer, Payment Initiation, Virtual Accounts) is enabled on the Plaid
account; (2) the Link flow requests only `transactions`, never `auth` — Auth
would expose account and routing numbers, which transactions and balances never
do; (3) `PLAID_READ_ENDPOINTS` in `src/plaid/plaidEndpoints.ts` is an allow-list
and `plaidRequest` throws on anything outside it. The one-time Link script
(`scripts/plaid-link.ts`) is host-side and deliberately does _not_ use
`plaidRequest`, so the agent cannot create or exchange tokens at all.

**Categories are a closed list, and Plaid's are not used at all.** Plaid was
wrong _consistently_ rather than erratically (Walmart is `GENERAL_MERCHANDISE`
on all 234 of its transactions), so there is no disagreement signal to mine and
inheriting it produced confident wrong answers. The 31 user-defined categories
live in `categories` and are referenced **by name** — `categories.name` is
UNIQUE, so a foreign key can point at it, which buys integrity without touching
the query layer, and `ON UPDATE CASCADE` makes a rename one statement.
`plaid_category_primary` is still stored (it drives `transaction_type`) but
never becomes a category.

**Splits are exposed through the `transaction_categories` view, and `count(*)`
over it counts PARTS, not charges.** Every spending query reads the view so none
of them knows what a split is; every reported _transaction count_ must therefore
be `count(DISTINCT id)`. `transactionSearch` additionally groups by transaction,
or a split charge prints once per part.

**A charge is batched only after it posts.** A pending charge posts as a _new_
`transaction_id` carrying `pending_transaction_id`, so prompting earlier would
ask twice for one purchase and discard the first answer when the pending row is
retired. `categorizationPromptJob` filters `NOT pending` for exactly this
reason.

**Receipt photos can arrive before or after their Plaid charge.** A receipt
stays unmatched until Plaid offers one exact posted amount in its date window.
Jarvis then asks for user confirmation. It never confirms a match or changes a
category from a receipt photo alone.

**Plaid signs a POSITIVE amount as money leaving the account.** That inverts
most people's intuition and it is stored unchanged, because every other Plaid
field agrees with it. Spending totals SUM to a positive number once
`transaction_type = 'expense'` filters out inflows. `classifyTransactionType.ts`
also files a credit-card payment as a `transfer`, not an expense — Plaid
categorises it under `LOAN_PAYMENTS`, and counting it would double-count roughly
a month of card use on top of the purchases it settles.

**`transaction_type` is derived, so a rule change makes history stale.**
`/transactions/sync` only resends what Plaid itself changed, so editing
`classifyTransactionType.ts` does nothing to stored rows until
`make reclassify-transactions` replays the current rules over them. Two
classifications are load-bearing and were both found against real data: a credit
card payment is a `transfer` (Plaid files it under `LOAN_PAYMENTS`, and counting
it double-counts a month of card use), and `LOAN_DISBURSEMENTS` — where the
_card side_ of that payment lands as "Payment Thank You" with a negative amount
— is also a `transfer`. Left as an expense the latter does not merely fail to
count, it subtracts: it was hiding $29,645 of real spending. A negative expense
is a refund and is correct.

**The transaction cursor must commit with its page.** `/transactions/sync`
returns a page plus a `next_cursor`; `applyTransactionPage.ts` writes both in
one `db.begin()`. A hot reload kills the agent mid-sync routinely, and advancing
the cursor separately would skip transactions Plaid never offers again — a
silent, permanent gap. Replay is safe because every write upserts on
`plaid_transaction_id`.

**Migrations apply in filename-sort order** (`scripts/migrate.sh`). Numbers
aren't strictly unique historically (two `006_*` files exist); the latest is
`025_finance_audits.sql`, so the next is `026`.

## Dev workflow

All secrets are in 1Password and injected at runtime via
`op run --env-file=.env.tpl`.

**Jarvis runs on `ezbox`, an always-on Linux box on the LAN, not on this Mac.**
The Makefile exports `DOCKER_CONTEXT=ezbox`, so every `make` target below runs
here but acts on ezbox's Docker daemon over SSH. `op run` stays on the Mac, so
no secret is ever written to that host's disk. **ezbox runs other services and
owns its own firewall** — read "Sharing the host" in `docs/infrastructure.md`
before touching `docker-compose.yml`, the `Dockerfile`, or anything to do with
networking. A careless change there breaks more than Jarvis, and the host's
configuration lives in a separate private repository, not this one.

```bash
make deploy               # pull on ezbox, rebuild, recreate containers (the normal way to ship)
make dev                  # LOCAL stack on this Mac — collides with production over the bot token
make up                   # start all containers detached on ezbox
make down                 # stop all containers
make logs                 # tail container logs
make db                   # psql shell into Postgres
make migrate              # run pending SQL migrations from migrations/
make test                 # deno test src/tests/
make reembed              # (re)embed any null/stale rows: migration, outage recovery, or model change (in-container)
make reindex-photos       # heal photo search index: describe, re-OCR, rebuild chunks (in-container, idempotent)
make plaid-link           # one-time: link a bank via Plaid Hosted Link, print the access token (host-side)
make sync-transactions    # run the Plaid sync once now instead of waiting for the scheduler (in-container)
make reclassify-transactions  # re-derive transaction_type over stored history after the rules in classifyTransactionType change (in-container, idempotent)
make backfill-archives    # one-time: populate document_chunks from pre-existing archived files (in-container)
make prune-duplicates     # dry-run report of duplicate facts/relationships (in-container)
make consolidate-facts    # dry-run report of fact clusters to merge (in-container)
make trace                # trace summary (recent traces)
```

**The KG cleanup passes are dry-run by default.** `make prune-duplicates` and
`make consolidate-facts` only report; the `-apply` variants
(`make prune-duplicates-apply`, `make consolidate-facts-apply`) pass `--apply`
and actually mutate the graph. Fact consolidation additionally prompts for
approval of each exact model proposal before writing it.

`make backup` is a stub — it prints "not yet implemented (Phase 8)" and does
nothing.

**Hot reload is on in production, deliberately.** ezbox runs the
`docker-compose.dev.yml` overlay permanently: `/opt/ai-assistant/src` is
bind-mounted into the agent, which runs `deno run --watch`. There is only one
stack, and development happens on it — edit over `ssh ezbox`, and the change is
live in seconds with no deploy. The cost is that a save while Jarvis is
mid-processing kills the turn and loses the Telegram message.

**A bind mount source is resolved by the daemon, not by the compose CLI.** That
is why `docker-compose.dev.yml` reads `${JARVIS_ROOT:-.}/src` and the Makefile
sets `JARVIS_ROOT=/opt/ai-assistant` — a bare `./src` would point at a Mac path
that does not exist on ezbox. Note also that the _image_ is built from this
Mac's working tree (the CLI ships its own build context to the remote daemon)
while the _running_ code is ezbox's bind mount. Keep the two in sync through
git.

**Only `make deploy` needs the Mac.** Reboots do not: `restart: unless-stopped`
brings the containers back with the environment already baked in, so ezbox
recovers from a power cut or an unattended-upgrade reboot with nobody present.

**WARNING: Always use `make` commands, never raw `docker compose`.** Two reasons
now. Secrets are injected via `op run --env-file=.env.tpl` which the Makefile
handles — a direct `docker compose up` starts containers with blank env vars,
and the agent crashes or silently fails on any API call. And the Makefile sets
`DOCKER_CONTEXT`, so a raw command hits this Mac's Docker instead of ezbox's,
quietly starting a second Jarvis that fights the real one for the Telegram bot
token (Telegram answers 409 and drops messages).

**WARNING: `op run` fails closed on unresolved secrets.** Adding a new secret
reference to `.env.tpl` breaks _every_ `op run` make command (`dev`, `up`,
`migrate`, `trace`) until that item actually exists in the `ai.assistant`
1Password vault. Create the secret in 1Password _first_, then add its reference.

**Container-injected env is set at start, not by the watcher.** Adding a new env
var means a full `make dev`/`make up` restart to inject it — the hot-reload
watcher only reloads code.

**In-container scripts live under `src/`.** The Dockerfile copies only `src/`
and `deno.json` into the image, so anything that must run inside the agent
container (e.g. Deno backfill scripts in `src/backfill/`, run via
`docker compose exec agent deno run …`) belongs under `src/`. `scripts/` is for
host-side tooling and takes any executable — shell, Deno, whatever fits the job
— since none of it is copied into the image.

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

**`deno check` is authoritative — ignore IDE "Cannot find module '@/…'"
errors.** The IDE/TypeScript server doesn't resolve Deno's `@/` import map, so
it shows false module-resolution diagnostics on the absolute imports. If
`deno check` passes, the code is fine.

### Inspecting the database non-interactively

`make db` opens an interactive shell. For a one-off read query, exec into the
already-running postgres container (its env is set at container start, so no
`op run` needed):

```bash
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT …"'
```

## Coding conventions

- Functional style — functions are the primary unit of composition, not classes
- One exported function per file, file named after the export (camelCase)
- Files under ~100 lines; split if larger
- Named exports only, absolute imports (`@/` prefix)
- Descriptive variable names — no abbreviations (`queryVector` not `queryVec`,
  `queryVectorLiteral` not `qLit`). The only accepted short form is `err` in
  catch blocks (codebase-wide convention; avoids colliding with the `error`
  logger).
- Early returns, no deep nesting
- **Make the code self-documenting; treat a comment as a smell.** A comment
  usually means the code failed to express itself — fix _that_ first. Optimize
  for readability and maintainability: precise names, small single-purpose
  functions, named constants instead of inline numbers, descriptive
  literal-union values (`"search-query"`/`"stored-document"`, not
  `"query"`/`"document"`), and options objects instead of long positional arg
  lists. A reader (human or LLM) should grasp intent from the code alone. Aim to
  remove almost all comments. The few that remain should explain _why_ the code
  can't — non-obvious rationale, how an empirical value was derived, or an
  external gotcha (a library quirk) — never _what_ the code does or _how_ it
  does it.
- **Outbound calls to external APIs go through `src/retry/`.** Use
  `fetchWithRetry(input, init, { timeoutMs })` for raw HTTP (handles backoff,
  jitter, Retry-After, per-attempt timeouts, and retries 408/425/429/5xx +
  network/timeout errors; pass `timeoutMs`, never put `AbortSignal.timeout` in
  `init` — it's reused across attempts and goes stale). Use
  `withRetry(fn, options)` for non-fetch or stateful operations (e.g. B2 upload,
  which re-authorizes via `onRetry`). Vercel AI SDK model calls use the SDK's
  retry option.
- **Write `jsonb` columns with `db.json(value as never)`, never
  `${JSON.stringify(value)}`.** postgres.js serializes the value itself; a
  pre-stringified string gets double-encoded and stored as a JSON _string_, not
  an object — so `->>'key'` returns null, and any read-modify-write path can
  snowball it into megabytes (this caused a real 52MB corruption + crash).
  `trace.ts` is the reference. More broadly: verify a library's serialization/IO
  behavior with a quick throwaway probe (e.g. a TEMP-table insert) before
  trusting an assumption — guessing cost real time this session.
- **`NUMERIC` parses to a JS number; `int8` (including `count(*)`) still arrives
  as a string.** postgres.js returns `NUMERIC` as a string to protect arbitrary
  precision, which would silently turn `total + amount` into concatenation and
  `amount > 100` into a lexical comparison. `db.ts` registers a `numeric` parser
  to fix that — verified not to affect integers or `REAL`. It does **not** cover
  `int8`, so keep writing `count(*)::int` (or `Number(...)`) as the existing
  code does.
- Conventional commits: `type(scope): description`

## Documentation

The `docs/` directory contains architecture docs and development plans. Read
these before making design decisions — they capture constraints and rationale
that aren't obvious from the code.

### Architecture (docs/)

| Doc                    | Covers                                                        |
| ---------------------- | ------------------------------------------------------------- |
| `vision.md`            | What we're building, principles, scope                        |
| `primitives.md`        | The 7 composable primitives the system is built on            |
| `data-architecture.md` | Storage layers, schema design, where data lives               |
| `data-lifecycle.md`    | How data ages — ingestion → compaction → knowledge graph      |
| `context-assembly.md`  | How the prompt is built from knowledge + conversation history |
| `event-engine.md`      | Scheduling, reminders, recurring tasks                        |
| `ingestion.md`         | What data comes in, from where, and how                       |
| `interfaces.md`        | Telegram, smartwatch, AirPods — communication channels        |
| `infrastructure.md`    | Server setup, costs, deployment                               |
| `security.md`          | Threat model, container isolation, credential handling        |
| `trust-model.md`       | Phased autonomy — how capabilities expand over time           |
| `setup.md`             | Full setup/recovery guide                                     |
| `landscape.md`         | Competitive landscape — why build vs buy                      |

### Development plans (docs/development/)

| Doc                         | Covers                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `roadmap.md`                | Phased implementation plan                                                                                  |
| `version-one.md`            | V1 scope — conversational chatbot (current)                                                                 |
| `version-two.md`            | V2 scope — memory, email, security                                                                          |
| `group-chat-support.md`     | Multi-chat isolation with shared knowledge graph                                                            |
| `deepresearch.md`           | Multi-step research workflow                                                                                |
| `event-pipeline-cleanup.md` | Event/reminder pipeline rework                                                                              |
| `workflow-*.md`             | Step-by-step traces through realistic use cases (financial, recall, research, medical research, tasks, SMS) |

When working on a feature or debugging behavior, check the relevant architecture
doc first — the answer is often already documented.

## File layout

```
src/
  main.ts                    # entrypoint — health check, bot start, event loop
  db.ts                      # Postgres connection (postgres.js)
  trace.ts                   # trace(traceId, step, detail) → engine_trace table
  logger.ts                  # structured logging
  conversationHistory.ts     # persist/load conversation messages
  ai/                        # provider configuration, primary generation, and usage tracing
  engine/                    # event queue, processing loop, tool execution
  knowledge/                 # knowledge graph tools, hybrid search, storage
  embeddings/                # Gemini embedding client, chunking, vector helpers
  events/                    # event/reminder CRUD
  audio/                     # Deepgram transcription, Telegram file download
  archive/                   # Backblaze B2 upload, photo indexing, archive embedding + search + send
  ocr/                       # Mistral OCR
  vision/                    # vision descriptions of images (retrieval text for charts)
  encoding/                  # byte encoders used by external API clients
  telegram/                  # grammY bot, voice/photo/document handlers, messaging tool
  prompt/                    # system prompt assembly, token estimation
  tools/                     # tool registry, tool types, tool input parsing, calendar
  plaid/                     # Plaid REST client — read-endpoint allow-list, balances, transaction pages
  finance/                   # Plaid sync job: account upsert, page apply, categorization, issue reports
  scheduler/                 # job registry + tick loop; claims due scheduled_jobs and records job_runs
  retry/                     # withRetry + fetchWithRetry (backoff/jitter/timeout) for external APIs
  maintenance/               # standing in-container commands: reembed, reindexPhotos, dedup pruning, fact consolidation
  backfill/                  # archives.ts — one-time migration: populate document_chunks (run in-container)
  tests/                     # deno test suite — run via `make test`
migrations/                  # numbered SQL files applied by scripts/migrate.sh
scripts/                     # host-side tooling, any executable (not copied into the image)
  trace.sh                   # trace debugging CLI
  migrate.sh                 # migration runner
  # NOTE: host setup (Docker install, firewall grants) lives in ezbox's own private repo, not here
```
