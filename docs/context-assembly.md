# Context Assembly

How the agent constructs its prompt from the knowledge system. Bridge between data storage ([data-architecture.md](data-architecture.md)) and conversation. Implementation: `agent/src/prompt/`.

## The continuous conversation model

There are no "sessions." Interactions arrive as a continuous stream across channels. The agent maintains continuity by graduating information into the knowledge graph and retrieving it on demand — not by holding onto raw text.

## Prompt layers

Every prompt is assembled from four layers, ordered for cache efficiency. The first two are stable and cached; the last two are dynamic.

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

**Currently implemented:** Layer 1 (system prompt in `agent/src/prompt/system-prompt.ts`) and Layer 4 (conversation messages in `agent/src/conversation/messages.ts`) with simple token-based truncation (`agent/src/prompt/tokens.ts`). Layers 2 and 3 are designed but not yet built.

### Layer 1 — Stable prefix (cached across all turns)

System prompt, tool definitions, user profile. Changes only when preferences are updated or tools are modified. Uses Anthropic's prompt caching (ephemeral `cache_control`).

### Layer 2 — Daily prefix (cached within a day)

Situational awareness rebuilt nightly: today's calendar, active tasks, pending items, recent facts, financial alerts. Identical across all turns within a day, caches behind the stable prefix.

### Layer 3 — Recent prefix (semi-stable)

Condensed context from recent conversation, assembled from the knowledge graph. A view over the graph filtered by recency — not a separate data structure. Changes only at compaction boundaries.

### Layer 4 — Raw conversation

Actual messages since the last compaction. Grows with each turn. When this exceeds a token budget, compaction fires.

## Compaction

Unlike traditional chat summarization (lossy text → shorter text), this system extracts structured facts to the knowledge graph (lossless for what matters). When you say *"I'm thinking about refinancing,"* the graph stores a structured record. Three months later, the agent queries the graph — precise, structured, handful of tokens.

### What compaction produces

1. **Structured records** in the knowledge graph (entities, facts, relationships, tasks, events).
2. **Condensed context** in the recent prefix — narrative thread, not raw transcript.
3. **Raw transcript** to the file store for archival.

### Trigger and post-compaction state

Token budget on raw conversation, not message count. After compaction fires, oldest raw messages drop from Layer 4; the most recent ~20 user messages remain. Extracted knowledge and condensed narrative available in Layers 2 and 3.

## Mid-day event handling

Important events during the day reach the agent without rebuilding the cached daily prefix:

- **Proactive notifications** for events worth interrupting you (urgent email, financial alert) — sent via Telegram, naturally becomes part of Layer 4.
- **Silent context injection** for routine updates — agent queries the knowledge graph for new entries since last turn and includes them as context.

The daily prefix doesn't update mid-day. Cache on Layers 1 and 2 stays intact.

## Nightly process

Scheduled job that runs during a quiet period:

1. Trim the recent prefix — most conversation context has been extracted to the knowledge graph.
2. Rebuild the daily prefix — tomorrow's calendar, active tasks, pending items.
3. Archive conversation logs to the file store.

## Formatting

Efficient, scannable representations — not prose paragraphs. Calendar events as one line per event, tasks grouped by project, facts as entity + attribute + value. This is context engineering — principle #9 in [vision.md](vision.md).

## Query-specific retrieval

Per-turn RAG: structured database for exact data, knowledge graph traversal for connections and temporal facts, vector search for semantic matches, file retrieval for deeper context. Results appended alongside the conversation without disturbing cached prefix layers.

**Pre-fetch teaser.** Every user message gets a lightweight knowledge graph match before reaching the LLM. The result is a manifest — not the facts themselves, just a summary of what's available (entity names, fact counts, relevance) and a note that archives were not searched. The LLM sees this alongside the user's message and knows the shape of available knowledge before reasoning.

Two retrieval tools with distinct roles: **`query_knowledge`** searches the active knowledge graph (entities, facts, relationships). Results are post-processed by a lightweight LLM (Haiku) for formatting and always include a nudge to try different queries or search the archives if results are insufficient. **`search_archives`** searches the archive index — permanent embeddings of every original document archived to B2. The LLM calls it explicitly when it needs historical context, reasoning behind decisions, or content not captured in the knowledge graph.

> **Open question:** Should retrieval results persist across turns within a topic, or be re-fetched each turn? Likely: persist within a topic, drop when the topic shifts — but the heuristic for "topic shift" needs design.
