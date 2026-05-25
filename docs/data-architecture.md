# Data Architecture

Where data lives, how it's structured, and how it's pulled into the LLM's context at query time. Sister doc to [data-lifecycle.md](data-lifecycle.md), which covers how data ages and gets compressed over time.

## Storage layers

The system uses a multi-layer storage architecture. Different types of memory live at different levels, and only the relevant slice gets pulled into the LLM's context window for any given interaction.

### Layer 1 — Structured database (Postgres)

Standard relational data: contacts, accounts, recurring events, tasks, projects, preferences, transaction history.

When the assistant needs *"what bills are due this Friday,"* it runs a database query. No AI involved in the retrieval. The LLM reasons about the data once retrieved, not to find it.

### Layer 2 — Vector store (pgvector)

Stores embeddings — numerical representations of text that capture semantic meaning. Conversations, notes, emails, and documents are chunked, embedded via an embedding model (OpenAI `text-embedding-3-small` or equivalent), and stored with metadata. At query time, the user's question is embedded and compared against stored chunks to find semantically similar content. This is the core of RAG (Retrieval Augmented Generation).

**Best practice:** hybrid search combining keyword-based search (BM25) with vector/semantic search delivers significant relevance gains over either method alone.

pgvector runs as a Postgres extension — no separate database needed. Documents and embeddings live in the same table, same transaction, no sync issues.

Two logical partitions within pgvector:

- **Active index.** Embeddings of current summaries and recent full-text content. Lean, pruned, fast. What the daily reasoning layer queries.
- **Archive index.** Embeddings of every original document chunk, ever. Larger, but still well within pgvector's capabilities. Searched when deeper retrieval is needed.

### Layer 3 — Knowledge graph (Postgres tables)

Handles structured recall and temporal reasoning that vector search can't. *"What did the landscaper's contract say about cancellation?"* and *"What changed about my finances between January and March?"* require understanding connections between entities and how facts evolve over time.

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

When the landscaper's contract renews at a new rate, set `valid_until = now()` on the old rate fact and insert the new one. Query what's true now with `WHERE valid_until IS NULL`. Query what was true at any date with `WHERE valid_from <= $date AND (valid_until IS NULL OR valid_until > $date)`.

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

## The file store — active storage and permanent archive

**Critical architectural principle: the knowledge system is a cache, not a replacement. The files are the source of truth.**

The file store uses **Backblaze B2** (S3-compatible object storage) as the agent's archive and active file system. **Google Drive** serves as an ingestion source — you drop files there or they're already there, and the agent picks them up for processing. After processing, the agent stores its own copy in B2 alongside all other archived files.

This separation keeps the archive clean (no machine-generated clutter in your Drive) and cheap (B2 is ~$0.005/GB/month vs Drive at ~$0.02/GB/month). Google Drive stays your personal file system; B2 is the agent's.

Files flow in from multiple sources:

- **Ingested files:** email attachments, documents sent via Telegram, OCR'd physical mail, voice memo audio
- **Google Drive files:** documents from your existing Drive, watched and ingested automatically
- **Agent-created files:** research summaries saved as PDFs, web pages captured during research, comparison documents, exported analyses
- **User-uploaded files:** sent to the Telegram bot for processing

Every file is cataloged in the knowledge graph as an entity with metadata (source, type, related entities, ingestion date, status). The knowledge graph entry is the index; the file store holds the content.

### File lifecycle

Files are **never deleted** from the file store. When a file is no longer relevant:
- The knowledge graph entity gets a `status = 'inactive'` flag and a `valid_until` timestamp
- The file remains in storage for future reference, reprocessing, or dispute resolution
- Inactive files are excluded from active search results unless explicitly requested
- Storage is cheap enough that retention is permanent — see economics below

### File store organization

```
files/
├── 2026/
│   ├── 01/
│   │   ├── emails/
│   │   │   └── 2026-01-15T09:32:00Z_from-sarah_re-new-job.json
│   │   ├── documents/
│   │   │   └── 2026-01-20_tax-w2-employer.pdf
│   │   ├── voice-memos/
│   │   │   └── 2026-01-22T10:00:00Z_post-meeting.md
│   │   ├── research/
│   │   │   └── 2026-01-25_housing-market-analysis.pdf
│   │   └── llm-logs/
│   │       └── 2026-01-15T08:00:00Z_morning-briefing.json
│   └── 02/ ...
```

Each file includes metadata: ingestion timestamp, data type, entities involved, processing applied, and a unique ID (`source_ref`) linking it to all derived artifacts in the knowledge system. Every summary, every knowledge graph fact, every embedding traces back to its source file.

### Storage economics

A year of heavy personal use (20,000 emails, 200 PDFs, 100 voice memos, research files, thousands of LLM logs) is ~2-5GB of raw data. On Backblaze B2, that's ~$0.03/month. Even after 10 years, storage costs are under $1/month. **There is no financial reason to delete files, ever.**

### Retrieval modes

- **Targeted.** Know roughly what you're looking for. The knowledge system identifies relevant `source_ref` IDs, fetches specific files from the store.
- **Exploratory.** Full natural-language search over files via the archive embedding index. For legal, audit, or dispute scenarios where summaries may not be sufficient.
- **Agent-initiated.** During analysis or research, the agent can pull files into the sandbox container for parsing, computation, or re-examination.

### Reprocessing capability

If a better embedding model or entity extraction tool emerges, the entire file store can be reprocessed through an improved pipeline. The files are the immutable foundation; everything else is a derived view that can be rebuilt.

## Query-time context assembly

When the assistant receives a query, the system retrieves from multiple storage layers — structured database, knowledge graph, vector search, and compressed summaries — and assembles the results alongside the agent's persistent context layers into a focused prompt. The LLM reasons over a carefully curated slice, not 100K tokens of raw history.

The full prompt construction model — persistent context layers, caching, compaction, and per-query retrieval — is described in [context-assembly.md](context-assembly.md).
