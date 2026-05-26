# Core Loop

How the core container works at runtime. Core is a Claude-Code-style agentic event processor: a system prompt, a set of coarse tools, a skills database, and an event-driven loop that runs continuously.

## The event loop

Core runs a continuous loop:

1. **Check the event queue.** Pick the highest-priority pending event.
2. **Assemble context.** Build the four-layer prompt (stable prefix, daily prefix, recent prefix, conversation) plus any query-specific retrieval. See [context-assembly.md](context-assembly.md).
3. **Send to LLM.** The LLM reasons over the assembled context and either responds directly or calls tools.
4. **Execute tool calls.** Run the requested tool, collect results.
5. **Drain the event queue before the next LLM call.** Any events that arrived during tool execution are appended to the tool result as additional context: *"While you were working, these events arrived: [...]"*. The LLM sees them on its next reasoning step and can adjust.
6. **Repeat** until the LLM produces a final response with no more tool calls.
7. **Return to step 1.**

### Interruptability

The LLM is never interrupted mid-generation — new information is injected at the natural boundary between tool execution and the next API call. From the LLM's perspective, the world updated between thoughts, which is how it already processes tool results. A user Telegram message arriving mid-task appears as new context on the very next reasoning step.

## Event queue

All triggers — user messages, ingestion emissions, scheduled jobs — enter a single event queue. Events are processed by priority:

| Priority | Source | Behavior |
|---|---|---|
| **High** | User Telegram messages | Injected at the next tool boundary. The LLM sees them immediately and can pivot. |
| **Normal** | Ingestion emissions, scheduled triggers (briefings, compaction, pruning) | Queued. Processed when the current task finishes or during idle time. |

High-priority events are appended mid-turn. Normal-priority events wait until the current task completes and the loop returns to step 1.

## Tools

Core uses **coarse-grained tools** — each tool does significant work in application code, and the LLM says *what* it wants rather than *how* to get it. This keeps the tool list short (fewer tokens in the stable prefix) and pushes deterministic work into code rather than LLM reasoning.

The exact tool definitions will be designed during implementation. The principle is: if the logic is deterministic (database queries, entity matching, formatting), it belongs in application code behind a tool. The LLM's job is judgment — deciding what's important, what to surface, how to respond.

Version 1 tools: `query_knowledge`, `remember`, `manage_events`, `get_calendar`, `fetch_skill`, `send_message`. See [version-one.md](development/version-one.md) for definitions.

Version 2 adds: `manage_tasks` (task/project CRUD with surfacing policy filtering), `search_documents` (hybrid keyword + vector search). See [version-two.md](development/version-two.md).

Version 3 adds: `query_finances` (aggregation, date-range filtering, category grouping, period comparison, pace projection against the `transactions` table — the tool does the math, not the LLM). See [workflow-financial-tracking.md](development/workflow-financial-tracking.md).

## Skills

Skills are stored in a database table:

| Column | Purpose |
|---|---|
| `name` | Short identifier |
| `description` | One-line summary of when this skill is relevant |
| `body` | Full instructions, prompt patterns, and behavioral guidance |

The **name and description** of every skill are included in the stable prefix (Layer 1), so the agent always knows what skills exist. The agent has a tool to **fetch the full skill body** on demand when it decides a skill is relevant. This is lazy-loading — the stable prefix stays lean, and skill bodies are only pulled into context when needed.

Skills are how specialized behaviors are configured without code changes. Adding a new capability (a new type of briefing, a new analysis pattern, a new interaction style) is a database INSERT, not a deploy.

## Entity resolution

When processing ingested content, core handles all entity resolution. Ingestion has no access to the knowledge graph — it emits raw extractions ("person: Sarah, context: leaving Acme for Stripe"). Core matches these against existing entities using application code (name matching, email matching, relationship context).

When core cannot confidently resolve an entity — e.g., a first name that matches multiple contacts — it asks the user via Telegram rather than guessing. The emission enters a **pending** state until the user responds. The user's reply arrives as a high-priority event, and core resumes processing with the clarification.

### Design principle: act on available information

The agent should bias toward getting things done rather than asking questions. Store what you have, refine later. Ask follow-up questions only when the answer would change what you do next — not to fill in every blank.

Example: if the user says "remind me to give my dog a tick chew every month," the agent creates the event and stores a dog entity even without a name. If the user later says "Max needs his tick chew," the agent connects "Max" to the existing unnamed dog entity and updates it. This is a prompt engineering challenge, not a schema one — the system prompt instructs the LLM to watch for opportunities to enrich sparse entities.

Contrast: if the user says "help me file my taxes," the agent *should* ask whether they're filing jointly or separately, because that changes the entire task decomposition.

## Telegram routing

Core runs the Telegram bot directly via long polling (outbound only — no webhooks, no public endpoints). User text messages go straight into the raw conversation layer (Layer 4) for immediate processing with full context. No ingestion hop, no polling delay.

**File and voice attachments** sent through Telegram are forwarded to the ingestion container for processing (OCR, Whisper transcription, document parsing). Even though the source is trusted, file processing runs through ingestion to keep that code in one place and behind the isolation boundary. Processed results are emitted back through the standard `ingestion_emissions` table.

## Relationship to other docs

- Prompt construction: [context-assembly.md](context-assembly.md)
- Container isolation and permissions: [security.md](security.md)
- Ingestion emission flow: [security.md](security.md) (ingestion container section)
- Tool execution safety: [security.md](security.md) (circuit breakers, kill switch)
