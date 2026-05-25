# Infrastructure

Where the system runs, how big it needs to be, and what it costs to operate. Security posture for the same infrastructure lives in [security.md](security.md).

## Server setup

**Single VPS, Docker Compose.** Everything runs on one machine.

**Recommended:** Hetzner CX32 or DigitalOcean droplet — 4 vCPUs, 8GB RAM, 80-160GB SSD. $15-30/month. More than sufficient for a single-user workload.

Docker Compose defines four services:

- **Postgres** (with pgvector extension): structured data, vector embeddings, and knowledge graph tables. See [data-architecture.md](data-architecture.md).
- **Core** (Python or Node): trusted orchestration — LLM API calls, tool execution, pruning jobs, user interaction. Has full database access. See [security.md](security.md) for the isolation model.
- **Ingestion** (Python or Node): isolated container that processes all untrusted external input (emails, Telegram messages, Plaid transactions, web content). Emits structured data to a narrow intake channel. No direct database access beyond its own emission table. See [security.md](security.md).
- **Sandbox** (Python, gVisor runtime): executes LLM-generated code for ad-hoc analysis, PDF parsing, and computations. Receives a read-only data slice from core, returns structured results. No network access, no secrets, no database connection. Destroyed and recreated per task.

### Project layout

```
project/
├── docker-compose.yml
├── core/                 # Trusted orchestration server
├── ingestion/            # Isolated ingestion pipeline
├── sandbox/              # Code execution sandbox (gVisor)
├── backups/              # Backup scripts
├── data/
│   └── postgres/         # Postgres data volume
```

**No `.env` files.** All secrets (API keys, DB credentials, OAuth tokens) live in 1Password and are retrieved at runtime via the 1Password CLI (`op run`) or Connect server. See [security.md](security.md).

The LLM reasoning layer is **not hosted** — it's API calls to Claude or OpenAI. No GPU needed. The server is an orchestrator: receives trigger, gathers context from the database, assembles prompt, sends to LLM API, processes response.

### Network access

No public-facing HTTP endpoints. The server is accessed exclusively via SSH and WireGuard VPN. Ingestion happens through outbound polling (Gmail API, Google Calendar API) and the Telegram bot API (long polling, not webhooks — no inbound connections needed). See [security.md](security.md).

## Storage sizing

| Data type | Estimated Year 1 size |
|---|---|
| Contacts & relationship metadata (500 people) | 5–10 MB |
| Knowledge graph (entities, relationships, facts) | 50–100 MB |
| Calendar events | Negligible |
| Financial transactions (if cached) | ~50 MB |
| Conversation logs, emails, notes (raw text) | 500 MB – 1 GB |
| Vector embeddings (100K chunks × ~6KB each) | ~600 MB |
| **Total active system** | **~2–4 GB** |
| Archive in object storage | 2–5 GB/year |

**This is a smart data system, not a big data system.**

## Backup & recoverability

Everything is in one Postgres database — one backup strategy covers relational data, knowledge graph, and vector embeddings.

### Infrastructure failure

- Automated daily backups: `pg_dump` → compressed → encrypted with GPG key stored off-server → shipped to object storage (different provider than hosting).
- VPS provider volume snapshots enabled as belt-and-suspenders.
- Recovery: spin up new VPS, pull docker-compose repo, retrieve secrets from 1Password, restore from latest backup. **Max data loss: 24 hours** (or less with more frequent dumps).

### Agent knowledge corruption

Three tiers of protection:

1. **Audit log.** Every agent action that modifies state is logged with full context — what it read, what it concluded, what it changed.
2. **Weekly knowledge snapshots.** Full `pg_dump` labeled as restore points (*"the system as it was on Sunday night"*).
3. **Confidence & review system.** High-impact changes (merging contacts, changing relationship categorizations, updating financial rules) go to a "pending changes" queue for human review in the daily briefing. Low-stakes updates (logging an email, noting a calendar event) write directly.

### Architectural safeguard

- Every write the agent makes is an append, never a destructive update. (Principle #3 in [vision.md](vision.md).)
- Changelog table in Postgres: old value, new value, timestamp, reason, triggering LLM call.
- The facts table's temporal model tracks validity windows — old facts get `valid_until` set, never deleted. Surgical rollback of specific facts without touching anything else. See schema in [data-architecture.md](data-architecture.md).
- **Nuclear option:** nuke the knowledge graph tables and rebuild from the archive. (The archive is the source of truth.)

## Sandbox container

The sandbox runs LLM-generated code — ad-hoc analysis, PDF parsing, numerical computations, data transformations. It uses **gVisor** (`runsc`) as an alternative Docker runtime. Standard Docker shares the host kernel; gVisor interposes a user-space kernel that intercepts syscalls. On DigitalOcean/Hetzner, gVisor runs in ptrace mode (no nested virtualization).

**Isolation constraints:**
- No network access (no outbound connections, no DNS)
- No secrets or database connection string
- Receives only a read-only data slice prepared by the core container
- Returns structured results through a mounted output volume
- Destroyed and recreated per task — no persistent state
- Resource-limited: CPU time cap, memory cap, disk quota

**Execution flow:** Core decides a query needs computation → core extracts the relevant data slice (e.g., transaction CSV, PDF content) → core writes data to a temporary input volume → sandbox runs LLM-generated code against the input → sandbox writes results to output volume → core reads results and validates before acting on them.

## Monthly operating costs

| Item | Estimated cost |
|---|---|
| VPS (4 vCPU, 8GB RAM) | $15–30 |
| Object storage (archive + backups) | < $1 |
| LLM API (Claude/OpenAI, ~10-20 queries/day + briefings + triage) | $10–30 |
| Embedding API (ingestion + archive indexing) | $2–5 |
| 1Password (existing subscription) | $0 incremental |
| **Total** | **~$30–60/month** |

Pruning pipeline costs (~$1-3/month in summarization calls) are included in the LLM line; see [data-lifecycle.md](data-lifecycle.md) for the breakdown.
