# Infrastructure

Where the system runs, how big it needs to be, and what it costs to operate. Security posture for the same infrastructure lives in [security.md](security.md).

## Server setup

**Single VPS, Docker Compose.** Everything runs on one machine.

**Recommended:** Hetzner CX32 or DigitalOcean droplet — 4 vCPUs, 8GB RAM, 80-160GB SSD. $15-30/month. More than sufficient for a single-user workload.

Docker Compose defines two services:

- **Postgres** (with pgvector extension): structured data, vector embeddings, and knowledge graph tables. See [data-architecture.md](data-architecture.md).
- **Application server** (Python or Node): orchestration logic, LLM API calls, ingestion pipeline, pruning jobs.

### Project layout

```
project/
├── docker-compose.yml
├── app/                  # Orchestration server
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

## Sandboxing (future)

If the agent ever needs to execute generated code (code interpreter tool, script runners), use **gVisor** (`runsc`) as an alternative Docker runtime for those containers. Standard Docker shares the host kernel — gVisor interposes a user-space kernel that intercepts syscalls. On DigitalOcean, gVisor runs in ptrace mode (no nested virtualization). Sandbox containers must not have access to secrets or the database connection string.

This is not a day-1 requirement. The current design is an orchestrator that runs trusted code and calls LLM APIs — no arbitrary code execution. Add gVisor when code execution capabilities are introduced.

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
