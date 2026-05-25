# Infrastructure

Where the system runs, how big it needs to be, and what it costs to operate. Security posture for the same infrastructure lives in [security.md](security.md).

## Server setup

**Single VPS, Docker Compose.** Everything runs on one machine.

**Recommended:** Hetzner CX32 or DigitalOcean droplet — 4 vCPUs, 8GB RAM, 80-160GB SSD. $15-30/month. More than sufficient for a single-user workload.

Docker Compose defines four services:

- **Postgres** (with pgvector extension): structured data, vector embeddings, and knowledge graph tables. See [data-architecture.md](data-architecture.md).
- **Core** (Deno): trusted orchestration — LLM API calls, tool execution, pruning jobs, user interaction. Has full database access. See [security.md](security.md) for the isolation model.
- **Ingestion** (Deno): isolated container that processes all untrusted external input (emails, Telegram messages, Plaid transactions, web content). Emits structured data to a narrow intake channel. No direct database access beyond its own emission table. Deno's permission system provides an additional isolation layer — `--allow-net` scoped to specific API domains. See [security.md](security.md).
- **Sandbox** (Deno): executes LLM-generated code for ad-hoc analysis, PDF parsing, and computations. Receives a read-only data slice from core, returns structured results. No network access, no secrets, no database connection. Destroyed and recreated per task.

### Project layout

```
project/
├── docker-compose.yml
├── core/                 # Trusted orchestration server
├── ingestion/            # Isolated ingestion pipeline
├── sandbox/              # Code execution sandbox (Deno)
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

The sandbox runs LLM-generated code — ad-hoc analysis, PDF parsing, numerical computations, data transformations. It uses **Deno** (TypeScript) inside a locked-down Docker container. Deno's built-in permission system (`--deny-net`, `--deny-env`, `--allow-read=/input`, `--allow-write=/output`) provides application-level sandboxing, while Docker provides OS-level isolation via seccomp profiles and cgroup resource limits.

> **Decision (2026-05-25):** gVisor removed from the stack. gVisor's syscall-level isolation is designed for multi-tenant environments running untrusted code from the internet. In this system, the sandbox runs LLM-generated code from your own trusted API calls — the threat is "buggy code that runs forever or consumes too many resources," not "adversarial code exploiting a kernel vulnerability." Docker with `--network=none`, memory/CPU limits, seccomp defaults, and a read-only filesystem is sufficient for this threat model. Deno further reduces the attack surface — no C extensions, no `ctypes`, no arbitrary syscalls — making the combination stronger than Python + gVisor for this use case.

**Isolation constraints:**
- No network access (`--network=none` at Docker level, `--deny-net` at Deno level)
- No secrets or database connection string
- No access to environment variables (`--deny-env`)
- Receives only a read-only data slice prepared by the core container (`--allow-read=/input`)
- Returns structured results through a mounted output volume (`--allow-write=/output`)
- Destroyed and recreated per task — no persistent state
- Resource-limited: CPU time cap, memory cap, disk quota (Docker cgroup limits)
- Default seccomp profile restricts dangerous syscalls

**Execution flow:** Core decides a query needs computation → core extracts the relevant data slice (e.g., transaction CSV, PDF content) → core writes data to a temporary input volume → sandbox runs LLM-generated TypeScript against the input → sandbox writes results to output volume → core reads results and validates before acting on them.

## Monthly operating costs

### Non-LLM infrastructure

| Item | Estimated cost |
|---|---|
| VPS (4 vCPU, 8GB RAM) | $15–30 |
| Object storage (archive + backups) | < $1 |
| Embedding API (text-embedding-3-small @ $0.02/MTok) | < $1 |
| Whisper API (voice memos, ~20 min/month @ $0.006/min) | < $1 |
| 1Password (existing subscription) | $0 incremental |
| **Subtotal** | **~$17–32** |

### LLM API costs

Assumes Haiku 4.5 ($1/$5 per MTok in/out) for ingestion, Sonnet 4.6 ($3/$15) or Opus 4.7 ($5/$25) for core reasoning. Cached input is 90% cheaper. Prompt caching is critical — the stable prefix (~2K tokens) and daily prefix (~2K tokens) are cached across turns, reducing per-turn input costs substantially.

| Component | Tokens/month (est.) | Sonnet core | Opus core |
|---|---|---|---|
| Conversations (15/day, growing context w/ caching) | ~5.5M input, ~225K output | ~$10 | ~$17 |
| Daily briefing (30/month) | ~240K input, ~30K output | ~$1 | ~$1.50 |
| Compaction (knowledge extraction from conversation) | ~450K input, ~60K output | ~$2.25 | ~$3.75 |
| Email triage + extraction (50/week, Haiku) | ~400K input, ~100K output | ~$1 | ~$1 |
| Web search (~50 searches/month + result processing, Haiku) | ~250K input, ~50K output + $0.50 search fees | ~$1 | ~$1 |
| Pruning & summarization (weekly, Haiku) | ~50K input, ~10K output | < $1 | < $1 |
| **LLM subtotal** | | **~$15–16** | **~$25** |

### Total estimates

| Scenario | Monthly cost |
|---|---|
| **Normal use, Sonnet core** (15 interactions/day, 50 emails/week) | **~$33–48** |
| **Normal use, Opus core** | **~$42–57** |
| **Heavy use, Sonnet core** (30 interactions/day, 100 emails/week, frequent research) | **~$50–65** |
| **Heavy use, Opus core** | **~$65–80** |

The biggest variable is conversation volume — each additional daily interaction costs ~$0.02 (Sonnet) to ~$0.04 (Opus) with good caching. Proactive analysis sweeps (Month 3) add ~$3–5/month.
