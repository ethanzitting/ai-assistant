# Context Assembly

How the agent constructs its prompt from the knowledge system. This is the bridge between data storage ([data-architecture.md](data-architecture.md)) and conversation — the mechanism that makes the agent feel like it knows what's going on without carrying your entire life in every prompt.

The design optimizes for two things simultaneously: **contextual awareness** (the agent always knows what's happening) and **token efficiency** (via prompt caching and structured retrieval instead of brute-force history).

## The continuous conversation model

There are no "sessions." Interactions arrive as a continuous stream across channels — Telegram messages throughout the day, voice commands, proactive notifications. A message at 9am and a follow-up at 3pm about the same topic are part of the same ongoing conversation. The agent maintains continuity not by carrying unbounded history, but by graduating information into the knowledge graph and retrieving it on demand.

This means there's no "session start" or "session end" — just an ever-present agent that remembers because its memory is structured and queryable, not because it's holding onto raw text.

## Prompt layers

Every prompt is assembled from four layers, ordered for cache efficiency. The first two layers are stable and cached; the last two are dynamic.

```
┌─────────────────────────────────┐
│  Layer 1: Stable prefix         │  ← Cached across all turns
│  (system prompt, tools, prefs)  │
├─────────────────────────────────┤
│  Layer 2: Daily prefix          │  ← Cached within a day
│  (calendar, tasks, alerts)      │
├─────────────────────────────────┤
│  Layer 3: Recent prefix         │  ← Changes at compaction boundaries
│  (condensed conversation ctx)   │
├─────────────────────────────────┤
│  Layer 4: Raw conversation      │  ← Grows per turn
│  (actual messages)              │
├─────────────────────────────────┤
│  + Query-specific retrieval     │  ← Per-turn, appended as needed
│  (RAG results, file contents)   │
└─────────────────────────────────┘
```

### Layer 1 — Stable prefix (cached across all turns)

Content that rarely changes:

- System prompt: agent personality, capabilities, behavioral guidelines
- Tool definitions
- User profile: preferences, communication style, key facts from the knowledge graph

This layer changes only when preferences are updated or tools are modified. It sits at the top of every prompt, giving a cache hit on every turn via Anthropic's prompt caching.

### Layer 2 — Daily prefix (cached within a day)

The agent's situational awareness, rebuilt nightly:

- Today's calendar events, conflicts, and buffer status
- Active tasks and their statuses from the task & project engine
- Pending items requiring attention: unresolved events, follow-ups, stalled intentions
- Recent important facts from the knowledge graph (last 24–48 hours)
- Financial alerts or other time-sensitive conditions

This layer is identical across all turns within a day, so it caches cleanly behind the stable prefix. It's rebuilt during the [nightly process](#nightly-process).

### Layer 3 — Recent prefix (semi-stable, changes at compaction)

Condensed context from recent conversation, assembled from the knowledge graph. This is the destination for compaction — when the raw conversation grows too large, facts are extracted to the knowledge graph and the condensed residue lands here.

This layer gives the agent conversational continuity: awareness of what you've been discussing, decisions made, and context established. It changes only at compaction boundaries, not every turn — so between compactions, it's effectively cached.

**The recent prefix is not a separate data structure.** It's a view over the knowledge graph filtered by recency, formatted for LLM consumption. The same extraction pipeline that processes emails and voice memos processes conversation content into the knowledge graph. The same formatting logic that builds the daily prefix builds the recent prefix. The only difference is the time horizon and data selection.

### Layer 4 — Raw conversation

The actual messages between you and the agent since the last compaction. This grows with each turn and sits at the end of the prompt, after all cached layers.

When this layer exceeds a token budget, compaction fires.

## Compaction

Compaction in this system is fundamentally different from traditional chat summarization. Instead of compressing unstructured text into shorter unstructured text (lossy), the knowledge graph extracts structured facts (lossless for the things that matter).

When you say *"I'm thinking about refinancing,"* the knowledge graph stores a structured record: entity, status, first mention date. When you bring it up three months later, the agent queries the graph and gets the fact back — precise, structured, in a handful of tokens. The knowledge graph **is** compaction, but queryable instead of lossy.

### What compaction produces

1. **Structured records in the knowledge graph.** Entities, facts, relationships, tasks, events, preferences — extracted using the same pipeline that processes emails and voice memos. See [data-lifecycle.md](data-lifecycle.md) for the unified extraction model.
2. **Condensed context in the recent prefix.** The conversational thread — what was discussed, what was decided, what's pending — formatted efficiently for the LLM. This provides narrative continuity that structured facts alone can't.
3. **Raw transcript to the file store.** The full conversation goes to archival storage for future reference, reprocessing, or audit. No longer load-bearing for context.

### Compaction trigger

Token budget on the raw conversation layer, not message count. A message could be "yes" or a 500-word brain dump — token budget gives predictable context utilization. The initial heuristic targets roughly 20 user messages, tuned based on actual token patterns.

### Post-compaction state

After compaction fires, the oldest raw messages are dropped from Layer 4. The most recent messages (roughly the last 20 user messages) remain as raw conversation to preserve tone, flow, and immediate context. The extracted knowledge and condensed narrative are available in Layers 2 and 3.

## Mid-day event handling

Important events that happen during the day — new emails processed, calendar changes, task completions — need to reach the agent without rebuilding the cached daily prefix.

Two mechanisms, based on urgency:

### Proactive notifications

For events worth interrupting you: an urgent email, a financial alert, a calendar conflict. The core container sends a Telegram message (or other channel notification). This naturally becomes part of the raw conversation in Layer 4, and the agent is aware of it on the next turn. See [interfaces.md](interfaces.md) for the multi-channel output architecture.

### Silent context injection

For events that should inform the agent's next response but don't warrant a notification: a routine email processed, a calendar update, a completed background task. Before responding to your next message, the agent queries the knowledge graph for new entries since the last turn and includes them as context alongside the conversation.

**The daily prefix doesn't update mid-day.** New events either arrive as proactive messages (part of the conversation stream) or get picked up on the next turn via a quick graph query. The cache on Layers 1 and 2 stays intact.

## Nightly process

A scheduled job that runs during a quiet period each night:

1. **Trim the recent prefix.** Most of the day's conversation context has been extracted to the knowledge graph through compaction. Reset the recent prefix to just the condensed context from the most recent messages.
2. **Rebuild the daily prefix.** Tomorrow's calendar, active tasks, pending items, recent facts — assembled fresh from the knowledge graph.
3. **Archive conversation logs.** Full transcripts from the day go to the file store for permanent archival.

The morning daily briefing naturally re-establishes context. If you text at 11pm and pick up at 7am, the briefing bridges the gap — no session boundary, just a fresh daily prefix and the knowledge graph's full recall.

## Formatting

Different knowledge types are formatted in specific, efficient formats optimized for LLM consumption. The same formatting logic is used across the daily prefix and recent prefix — the only difference is the time horizon and data selection.

Efficient formatting means structured, scannable representations — not prose paragraphs:

- **Calendar events:** time, title, location, prep notes — one line per event
- **Active tasks:** status, priority, last action, next step — grouped by project
- **Recent facts:** entity + attribute + value, grouped by topic
- **Financial alerts:** amounts, dates, account context — the minimum needed for reasoning
- **Conversation context:** decisions, intentions, and pending items — narrative thread, not raw transcript

This is context engineering — principle #9 in [vision.md](vision.md). The right 3,000 tokens of structured, well-formatted context beats 100K tokens of raw history.

## Query-specific retrieval

Beyond the four prompt layers, the agent performs per-turn retrieval when you ask about something specific. This is the RAG pipeline described in [data-architecture.md](data-architecture.md):

1. **Structured database** for exact data (bills due, contact info, task status)
2. **Knowledge graph traversal** for entity connections and temporal facts
3. **Vector search** for semantically relevant documents, emails, and notes
4. **File retrieval** from the file store when deeper context is needed (contracts, research PDFs)

These results are assembled and appended to the prompt alongside the conversation, adding targeted context for the current query without disturbing the cached prefix layers.

> **Open question:** Should query-specific retrieval results persist across turns within a topic, or be re-fetched each turn? Persisting avoids redundant retrieval but grows the context; re-fetching keeps it lean but costs compute. Likely answer: persist within a topic, drop when the topic shifts — but the heuristic for "topic shift" needs design.
