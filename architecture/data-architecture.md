# Data Architecture

Where data lives, how it's structured, and how it's pulled into the LLM's context at query time. Sister doc to [data-lifecycle.md](data-lifecycle.md), which covers how data ages and gets compressed over time.

## Storage layers

The system uses a multi-layer storage architecture. Different types of memory live at different levels, and only the relevant slice gets pulled into the LLM's context window for any given interaction.

### Layer 1 — Structured database (Postgres)

Standard relational data: contacts, accounts, recurring events, preferences, transaction history.

When the assistant needs *"what bills are due this Friday,"* it runs a database query. No AI involved in the retrieval. The LLM reasons about the data once retrieved, not to find it.

### Layer 2 — Vector store (pgvector)

Stores embeddings — numerical representations of text that capture semantic meaning. Conversations, notes, emails, and documents are chunked, embedded via an embedding model (OpenAI `text-embedding-3-small` or equivalent), and stored with metadata. At query time, the user's question is embedded and compared against stored chunks to find semantically similar content. This is the core of RAG (Retrieval Augmented Generation).

**Best practice:** hybrid search combining keyword-based search (BM25) with vector/semantic search delivers significant relevance gains over either method alone.

pgvector runs as a Postgres extension — no separate database needed. Documents and embeddings live in the same table, same transaction, no sync issues.

Two logical partitions within pgvector:

- **Active index.** Embeddings of current summaries and recent full-text content. Lean, pruned, fast. What the daily reasoning layer queries.
- **Archive index.** Embeddings of every original document chunk, ever. Larger, but still well within pgvector's capabilities. Searched when deeper retrieval is needed.

### Layer 3 — Knowledge graph (Postgres tables)

Handles relationships and temporal reasoning that vector search can't. *"Who does Sarah work with?"* and *"What changed about my finances between January and March?"* require understanding connections between entities and how facts evolve over time.

At the scale of a single-user personal assistant (500–2,000 entities, 5,000–10,000 relationships), Postgres handles graph-shaped queries without meaningful performance issues. A dedicated graph database like Neo4j would add a second database to back up, monitor, and keep patched — operational complexity that isn't justified at this scale.

Three tables model the full knowledge graph:

**Entities** — people, places, organizations, accounts, any node type:

```sql
CREATE TABLE entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL,           -- 'person', 'organization', 'place', 'account'
    name TEXT NOT NULL,
    properties JSONB DEFAULT '{}', -- flexible attributes per entity type
    created_at TIMESTAMPTZ DEFAULT now(),
    source_ref TEXT               -- links back to archive original
);
```

**Relationships** — typed, directed edges between entities:

```sql
CREATE TABLE relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_a_id UUID REFERENCES entities(id),
    entity_b_id UUID REFERENCES entities(id),
    type TEXT NOT NULL,           -- 'sibling', 'works_at', 'lives_in', 'manages'
    properties JSONB DEFAULT '{}',
    valid_from TIMESTAMPTZ DEFAULT now(),
    valid_until TIMESTAMPTZ,      -- NULL = currently valid
    created_at TIMESTAMPTZ DEFAULT now(),
    source_ref TEXT
);
```

**Facts** — the temporal knowledge layer with validity windows:

```sql
CREATE TABLE facts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID REFERENCES entities(id),
    attribute TEXT NOT NULL,      -- 'city', 'job_title', 'employer', 'status'
    value TEXT NOT NULL,
    valid_from TIMESTAMPTZ DEFAULT now(),
    valid_until TIMESTAMPTZ,      -- NULL = currently true
    confidence REAL DEFAULT 1.0,
    source_ref TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

When Sarah moves from Denver to Portland, set `valid_until = now()` on the Denver fact and insert a new Portland fact. Query what's true now with `WHERE valid_until IS NULL`. Query what was true at any date with `WHERE valid_from <= $date AND (valid_until IS NULL OR valid_until > $date)`.

**Graph traversals** use recursive CTEs for multi-hop queries:

```sql
WITH RECURSIVE connections AS (
    SELECT r.entity_b_id, r.type, 1 AS depth
    FROM relationships r
    WHERE r.entity_a_id = :sarah_id AND r.valid_until IS NULL
    UNION ALL
    SELECT r.entity_b_id, r.type, c.depth + 1
    FROM relationships r
    JOIN connections c ON r.entity_a_id = c.entity_b_id
    WHERE c.depth < 3 AND r.valid_until IS NULL
)
SELECT e.name, e.type, c.type AS relationship
FROM connections c
JOIN entities e ON e.id = c.entity_b_id;
```

At this entity count, these queries execute in single-digit milliseconds.

> **Escape hatch:** If traversal queries eventually become complex enough to justify Cypher syntax, Apache AGE adds openCypher support as a Postgres extension — same database, no separate service. If the system grows to hundreds of thousands of entities, migrate the graph layer to a dedicated database at that point. The schema translates cleanly.

### Layer 4 — Hierarchical summarization

Progressive compression of older data. Recent interactions stored verbatim, older ones summarized into denser representations. Like human memory: yesterday's conversation in detail, last week's in broad strokes, six months ago as key takeaways.

This cuts token costs by 80-90% while potentially improving response quality by removing noise. Lifecycle rules in [data-lifecycle.md](data-lifecycle.md).

## The archive — permanent source of truth

**Critical architectural principle: the knowledge system is a cache, not a replacement. The originals are the source of truth.**

Every piece of raw data — every email, PDF, transcript, LLM interaction log — is archived to object storage (S3 or Backblaze B2) before any processing happens. Nothing gets summarized, embedded, or added to the knowledge graph until the original is safely archived. If the processing pipeline crashes halfway through, nothing is lost.

### Archive organization

```
archive/
├── 2026/
│   ├── 01/
│   │   ├── emails/
│   │   │   └── 2026-01-15T09:32:00Z_from-sarah_re-new-job.json
│   │   ├── documents/
│   │   │   └── 2026-01-20_tax-w2-employer.pdf
│   │   ├── transcripts/
│   │   │   └── 2026-01-22T10:00:00Z_project-standup.md
│   │   └── llm-logs/
│   │       └── 2026-01-15T08:00:00Z_morning-briefing.json
│   └── 02/ ...
```

Each archived item includes metadata: ingestion timestamp, data type, entities involved, processing applied, and a unique ID (`source_ref`) linking it to all derived artifacts in the knowledge system. Every summary, every knowledge graph fact, every embedding traces back to its archived original.

### Storage economics

A year of heavy personal use (20,000 emails, 200 PDFs, 100 transcripts, thousands of LLM logs) is ~2-5GB of raw data. On Backblaze B2, that's ~$0.03/month. Even after 10 years, storage costs are under $1/month. **There is no financial reason to delete originals, ever.**

### Retrieval modes

- **Targeted.** Know roughly what you're looking for. The knowledge system identifies relevant `source_ref` IDs, fetches specific files from the archive.
- **Exploratory.** Full natural-language search over originals via the archive embedding index. For legal, audit, or dispute scenarios where summaries may not be sufficient.

### Reprocessing capability

If a better embedding model or entity extraction tool emerges, the entire archive can be reprocessed through an improved pipeline. The archive is the immutable foundation; everything else is a derived view that can be rebuilt.

## Query-time context assembly

When the assistant receives a query — e.g., *"I'm seeing Sarah next week, help me prepare"* — the system:

1. Hits the **structured database**: Sarah's contact record, upcoming events, last interaction date. Cheap, fast, zero tokens.
2. Queries the **knowledge graph tables**: Sarah's relationships, temporal facts, related entities. Recursive CTE traversal, no LLM calls.
3. Does a **vector search**: "conversations with Sarah" filtered by recency, pulling the 3-5 most relevant chunks.
4. Pulls a **compressed summary** of broader history with Sarah if one exists.

All assembled into a prompt — maybe 2,000-4,000 tokens of highly relevant context. The LLM reasons over a carefully curated slice, not 100K tokens of raw history.

This is **context engineering** — the art of getting the right information into the smallest prompt. Principle #9 in [vision.md](vision.md).
