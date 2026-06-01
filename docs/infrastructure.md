# Infrastructure

Where the system runs, how big it needs to be, and what it costs to operate. Security posture for the same infrastructure lives in [security.md](security.md).

## Server setup

**Single VPS, Docker Compose.** Everything runs on one machine.

**Recommended:** DigitalOcean droplet — 4 vCPUs, 8GB RAM, 80-160GB SSD. $15-30/month. Hetzner is a viable alternative at similar specs.

Docker Compose defines the services — see `docker-compose.yml` for the actual definitions. Version 1 runs Postgres and Agent only. Ingestion and Sandbox containers are added in Version 2 and Version 3 respectively.

- **Postgres** (with pgvector): structured data, vector embeddings, knowledge graph tables.
- **Agent** (Deno): trusted orchestration — LLM API calls, tool execution, pruning jobs, user interaction. Full database access.
- **Ingestion** (Deno) *(Version 2)*: isolated container for untrusted external input. Emits structured data to a narrow intake channel. See [security.md](security.md).
- **Sandbox** (Deno) *(Version 3)*: executes LLM-generated code. No network, no secrets, no database. Destroyed per task.

**No `.env` files.** All secrets live in 1Password and are retrieved at runtime via `op run`. See [security.md](security.md).

The LLM reasoning layer is **not hosted** — it's API calls to Claude or OpenAI. No GPU needed. The server is an orchestrator.

## Development environment

Dev and production use the same Docker Compose stack. `docker-compose.dev.yml` adds volume mounts for hot-reload and relaxed resource limits. `Makefile` wraps common operations. See [setup.md](setup.md) for the full reference.

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

- Automated daily backups: `pg_dump` → compressed → encrypted → shipped to object storage (different provider than hosting). Each backup includes a metrics snapshot for comparison.
- Weekly backup verification: restore to a temporary Docker container, compare metrics, tear down.
- VPS provider volume snapshots as belt-and-suspenders.
- Recovery: spin up new VPS, pull docker-compose repo, retrieve secrets from 1Password, restore from latest backup. **Max data loss: 24 hours.**

### Agent knowledge corruption

1. **Audit log.** Every agent action that modifies state is logged with full context.
2. **Weekly knowledge snapshots.** Full `pg_dump` labeled as restore points. Verified against metrics snapshots.

### Architectural safeguard

- Every write is an append, never a destructive update. (Principle #3 in [vision.md](vision.md).)
- Changelog table: old value, new value, timestamp, reason, triggering LLM call.
- Temporal facts model tracks validity windows — surgical rollback of specific facts without touching anything else. Schema: `migrations/002_knowledge_graph.sql`.
- **Nuclear option:** nuke the knowledge graph tables and rebuild from the archive.

## Sandbox container

The sandbox runs LLM-generated code inside a locked-down Docker container with Deno. Deno's permission system provides application-level sandboxing; Docker provides OS-level isolation via seccomp and cgroup limits.

> **Decision (2026-05-25):** gVisor removed. Docker + Deno is sufficient for the threat model (buggy code, not adversarial kernel exploits). See full rationale in git history.

**Isolation constraints:** No network (`--network=none` + `--deny-net`), no secrets, no env vars, read-only input volume, write-only output volume, destroyed per task, CPU/memory/disk limits, default seccomp profile.

**Execution flow:** Agent prepares data slice → writes to temp input volume → sandbox runs TypeScript → writes results to output volume → agent reads and validates.

## Monthly operating costs

### Non-LLM infrastructure

| Item | Estimated cost |
|---|---|
| VPS (4 vCPU, 8GB RAM) | $15–30 |
| Object storage (archive + backups) | < $1 |
| Embedding API (Gemini `gemini-embedding-001`) | < $1 |
| Transcription API (Deepgram nova-2) | < $1 |
| **Subtotal** | **~$17–32** |

### LLM API costs

Assumes Haiku 4.5 for ingestion, Sonnet 4.6 or Opus 4.7 for reasoning. Prompt caching is critical — stable prefix and daily prefix are cached across turns.

| Scenario | Monthly cost |
|---|---|
| **Normal use, Sonnet core** (15 interactions/day, 50 emails/week) | **~$33–48** |
| **Normal use, Opus core** | **~$42–57** |
| **Heavy use, Sonnet core** (30 interactions/day, 100 emails/week) | **~$50–65** |
| **Heavy use, Opus core** | **~$65–80** |

The biggest variable is conversation volume — each additional daily interaction costs ~$0.02 (Sonnet) to ~$0.04 (Opus) with good caching.
