# Data Architecture

Where data lives, how it's structured, and how it's pulled into the LLM's context at query time. Sister doc to [data-lifecycle.md](data-lifecycle.md), which covers how data ages and gets compressed over time.

## Storage layers

The system uses a multi-layer storage architecture. Different types of memory live at different levels, and only the relevant slice gets pulled into the LLM's context window for any given interaction.

### Layer 1 — Structured database (Postgres)

Standard relational data: contacts, accounts, recurring events, tasks, projects, preferences, transaction history.

When the assistant needs *"what bills are due this Friday,"* it runs a database query. No AI involved in the retrieval. The LLM reasons about the data once retrieved, not to find it.

**Dedicated tables for structured domains.** The knowledge graph (entities, facts, relationships) handles general-purpose recall — "Sarah works at Stripe," "the landscaper's cancellation policy." But some data types need their own tables because they require numeric aggregation, specialized indexing, or high-volume time-series queries that the TEXT-valued `facts` table can't support efficiently. Financial transactions are the primary example. See [workflow-financial-tracking.md](development/workflow-financial-tracking.md) for the full schema and rationale.

### Layer 2 — Vector store (pgvector)

Stores embeddings — numerical representations of text that capture semantic meaning. Conversations, notes, emails, and documents are chunked, embedded via an embedding model (OpenAI `text-embedding-3-small` or equivalent), and stored with metadata.

**Best practice:** hybrid search combining keyword-based search (BM25) with vector/semantic search delivers significant relevance gains over either method alone.

pgvector runs as a Postgres extension — no separate database needed.

Two logical partitions:

- **Active index.** Embeddings of current summaries and recent full-text content. Lean, pruned, fast.
- **Archive index.** Embeddings of every original document chunk, ever. Searched when deeper retrieval is needed.

### Layer 3 — Knowledge graph (Postgres tables)

Handles structured recall and temporal reasoning that vector search can't. *"What did the landscaper's contract say about cancellation?"* and *"What changed about my finances between January and March?"*

At single-user scale (500–2,000 entities), Postgres handles graph-shaped queries without meaningful performance issues. No need for a dedicated graph database like Neo4j — operational complexity isn't justified at this scale.

Three tables: `entities`, `relationships`, `facts`. Schema is in `migrations/002_knowledge_graph.sql`. Key design decisions:

- **Temporal facts** — `valid_from`/`valid_until` windows. Old facts get `valid_until` set, never deleted. Query what's true now with `WHERE valid_until IS NULL`.
- **Graph traversals** via recursive CTEs for multi-hop queries — single-digit milliseconds at this entity count.
- **Escape hatch:** Apache AGE adds openCypher as a Postgres extension if traversals get complex enough to justify Cypher syntax.

### Layer 4 — Hierarchical summarization

Progressive compression of older data. Recent interactions stored verbatim, older ones summarized into denser representations. Lifecycle rules in [data-lifecycle.md](data-lifecycle.md).

## The file store — active storage and permanent archive

**Critical architectural principle: the knowledge system is a cache, not a replacement. The files are the source of truth.**

The file store uses **Backblaze B2** (S3-compatible object storage) as the agent's archive and active file system. **Google Drive** serves as an ingestion source — you drop files there, and the agent picks them up for processing. After processing, the agent stores its own copy in B2 alongside all other archived files.

Files flow in from multiple sources: email attachments, documents via Telegram, OCR'd physical mail, voice memo audio, Google Drive documents, agent-created research summaries, user-uploaded files.

Every file is cataloged in the knowledge graph as an entity with metadata (source, type, related entities, ingestion date, status). The knowledge graph entry is the index; the file store holds the content.

**Files are never deleted.** Inactive files get `status = 'inactive'` and `valid_until` in the knowledge graph, excluded from active search unless explicitly requested. A year of heavy personal use is ~2-5GB, costing ~$0.03/month on B2. No financial reason to delete files, ever.

**Reprocessing capability:** If a better embedding model or extraction tool emerges, the entire file store can be reprocessed. Files are the immutable foundation; everything else is a derived view.

## Core-ingestion coordination

The agent and ingestion containers communicate through two database tables, not direct network calls:

- **`ingestion_emissions`** — ingestion → agent. Structured records emitted after processing external content. Agent polls and validates. See [security.md](security.md).
- **`processing_requests`** — agent → ingestion. Agent inserts work requests, ingestion polls and claims them. See [workflow-financial-tracking.md](development/workflow-financial-tracking.md) for the schema.

Both tables are narrow coordination channels. Ingestion has INSERT-only on `ingestion_emissions` and SELECT+UPDATE on `processing_requests`. It cannot read the knowledge graph or any other table.

## Query-time context assembly

When the assistant receives a query, it retrieves from multiple storage layers and assembles results into a focused prompt. The full prompt construction model is described in [context-assembly.md](context-assembly.md). Implementation: `agent/src/prompt/`.
