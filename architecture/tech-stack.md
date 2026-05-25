# Technology Stack

Chosen technologies and a structured learning path for ramping up on the unfamiliar ones. This is reference material, not load-bearing architecture — the architectural rationale for each choice lives in the doc where it's used (e.g., why pgvector in [data-architecture.md](data-architecture.md), why WireGuard in [security.md](security.md)).

## Core technologies

| Technology | Purpose | Familiarity |
|---|---|---|
| **PostgreSQL** | Structured data, relational storage, knowledge graph tables | Known (full-stack web dev background) |
| **pgvector** | Vector embeddings, semantic search | New — learn |
| **Claude API / Anthropic SDK** | LLM reasoning, summarization, extraction | New — learn |
| **OpenAI Embeddings API** | Text → vector embeddings | New — learn |
| **Docker Compose** | Container orchestration | Likely known |
| **WireGuard** | VPN for server access | New — learn |
| **S3 / Backblaze B2** | Object storage for archive | Likely known |
| **1Password CLI / Connect** | Secrets management — all credentials at runtime | Likely known |
| **gVisor** | Sandbox container runtime — syscall-level isolation for LLM-generated code execution | New — learn |

> **Decision (2025-05-25):** Neo4j and Graphiti removed from the stack. The knowledge graph is modeled as Postgres tables (entities, relationships, facts) with temporal validity windows. At the scale of a single-user assistant (500–2,000 entities), recursive CTEs handle graph traversal in single-digit ms. Apache AGE is the escape hatch if Cypher syntax is ever needed. See [data-architecture.md](data-architecture.md).

## Structured learning path (Weeks 1–2)

### Phase 1 — Understand embeddings conceptually (Day 1–2)

- Search: `"what are vector embeddings explained for developers"`
- Search: `"embeddings RAG explained simply"`
- Key resource: DEV.to guide on embeddings and pgvector (explains with concrete examples of phrase similarity)

### Phase 2 — Postgres + pgvector hands-on (Day 2–4)

- Search: `"pgvector docker tutorial postgres vector database"`
- Start with pgvector GitHub README — covers installation, vector columns, distance operators.
- Search: `"pgvector RAG tutorial OpenAI embeddings postgres"`
- Key resource: Tiger Data's three-part tutorial (create embeddings → store with pgvector → augment LLM generation). Has Jupyter notebook.
- Docker setup: `pgvector/pgvector:pg16` image.

### Phase 3 — Knowledge graph schema design (Day 4–6)

- Design and implement the entities/relationships/facts tables from [data-architecture.md](data-architecture.md).
- Practice recursive CTEs for multi-hop traversal.
- Build temporal queries: "what was true at date X" using `valid_from` / `valid_until` windows.
- Search: `"postgres recursive CTE graph traversal tutorial"`
- Search: `"temporal data modeling postgres valid_from valid_until"`
- Seed with real relationship data (family, close friends) to test traversal and fact queries against realistic content.

### Phase 4 — Claude API + RAG pipeline (Day 6–10)

- Search: `"build RAG Claude API pgvector tutorial"`
- Key resource: Tiger Data's RAG + Claude + PostgreSQL walkthrough.
- Search: `"Anthropic Claude API tool use tutorial"`
- Key resource: Anthropic's official course at anthropic.com/learn/build-with-claude and anthropic.skilljar.com. Covers API setup, RAG, and tool use.
- Search: `"Claude API tool use function calling"`
- Core pattern: user question → Claude picks tools → your code executes → return tool_result → Claude writes final response. This is the fundamental loop of the entire assistant.

### Phase 5 — Docker Compose + secrets integration (Day 10–14)

- Search: `"docker compose postgres python app multi-service"`
- Search: `"1password CLI op run docker environment variables"`
- Search: `"pg_dump automated backup script docker cron"`
- Get Postgres + core + ingestion containers running locally. Wire secrets through `op run` so no `.env` file touches disk.
- Write one query flow that accepts a question, queries both relational and knowledge graph tables, assembles a prompt, calls Claude API, returns a response. Get backup scripts working.
