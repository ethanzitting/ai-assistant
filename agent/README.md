# Agent

Trusted orchestration container. Receives events from the queue, assembles context, calls the Claude API, and executes tool results. Full database access.

## Directory map

```
src/
├── main.ts                  # Entrypoint — connects to DB, starts the event loop
├── db.ts                    # Postgres connection pool
├── queue.ts                 # Event queue — poll, claim, complete/fail events
├── anthropic/               # Claude API client
│   ├── create-client.ts     # Anthropic SDK client initialization
│   ├── send-message.ts      # Send a message with prompt caching
│   ├── call-with-retry.ts   # Retry with exponential backoff (rate limits, overload)
│   └── mod.ts               # Re-exports
├── prompt/                  # Prompt construction
│   ├── system-prompt.ts     # System prompt + stable prefix (Layer 1)
│   ├── assemble.ts          # Assemble full prompt from all layers
│   └── tokens.ts            # Token counting and truncation
├── conversation/            # Conversation state
│   └── messages.ts          # Load and manage conversation message history
├── engine/                  # Agentic loop
│   ├── run.ts               # Main loop — poll queue, process events
│   ├── process-event.ts     # Handle a single event through the tool loop
│   ├── tool-loop.ts         # Execute tools until the model stops calling them
│   └── helpers.ts           # Extract text/tool-use blocks from API responses
├── knowledge/               # Knowledge graph operations
│   ├── search.ts            # query_knowledge tool — search entities, facts, relationships
│   ├── queries.ts           # SQL queries for knowledge graph search
│   ├── format.ts            # Format knowledge graph results for LLM consumption
│   ├── remember.ts          # remember tool — store new knowledge
│   ├── store.ts             # Insert entities, facts, relationships into the graph
│   └── resolve.ts           # Resolve entity references (find-or-create)
├── events/                  # Event & scheduling operations
│   ├── tool.ts              # manage_events tool — create, update, complete, list
│   ├── operations.ts        # CRUD operations on the events table
│   └── recurrence.ts        # Recurrence computation (fixed-schedule, interval-from-completion)
└── tools/                   # Other tools
    ├── registry.ts          # Tool registry — maps tool names to handlers
    ├── types.ts             # Shared tool type definitions
    ├── calendar.ts          # get_calendar tool
    ├── skill.ts             # fetch_skill tool
    └── messaging.ts         # send_message tool
```

## Architecture

The agent runs an **event-driven agentic loop**:

1. `engine/run.ts` polls the event queue for pending work
2. `engine/process-event.ts` assembles context via `prompt/` and calls the Claude API via `anthropic/`
3. If the model returns tool calls, `engine/tool-loop.ts` executes them and feeds results back
4. The loop continues until the model produces a final text response or the tool budget is exhausted

Tools are registered in `tools/registry.ts`. Each tool is a function that receives parameters and returns a string result.

## Docs

- Architecture and design rationale: `docs/` at project root
- Database schema: `migrations/`
- Development setup: `docs/setup.md`
