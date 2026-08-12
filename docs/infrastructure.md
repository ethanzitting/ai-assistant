# Infrastructure

Where the system runs, how big it needs to be, and what it costs to operate. Security posture for the same infrastructure lives in [security.md](security.md).

## Server setup

**Single machine, Docker Compose.** Everything runs on one always-on Linux box on the home LAN, reached over Tailscale and referred to here as `ezbox`. It replaced a MacBook Air in August 2026, after the laptop slept through nine days and nobody noticed Jarvis was down. A cloud VPS remains a viable alternative — see "Why not a VPS" below.

| Item | Value |
|---|---|
| Hardware | Small-form-factor desktop — 4 cores, 7.1 GB RAM, 233 GB NVMe |
| OS | Ubuntu 26.04 LTS, x86_64 |
| Reached by | `ssh ezbox` over Tailscale, key only |
| Repo path | `/opt/ai-assistant` |
| Measured load | ~152 MB RAM for all three containers; 66 MB database |

> **The host has other jobs**, and they constrain this deployment more than any capacity question does. Its network configuration is managed by a separate private repository, and Jarvis must not fight it. See "Sharing the host" below. Host-specific addresses, firewall rules and setup scripts live in that private repo, not here.

Docker Compose defines the services — see `docker-compose.yml` for the actual definitions. Version 1 runs Postgres and Agent only. Ingestion and Sandbox containers are added in Version 2 and Version 3 respectively.

- **Postgres** (with pgvector): structured data, vector embeddings, knowledge graph tables.
- **Agent** (Deno): trusted orchestration — LLM API calls, tool execution, pruning jobs, user interaction. Full database access.
- **Ingestion** (Deno) *(Version 2)*: isolated container for untrusted external input. Emits structured data to a narrow intake channel. See [security.md](security.md).
- **Sandbox** (Deno) *(Version 3)*: executes LLM-generated code. No network, no secrets, no database. Destroyed per task.

**No `.env` files.** All secrets live in 1Password and are retrieved at runtime via `op run`. See [security.md](security.md).

The LLM reasoning layer is **not hosted** — it's API calls to Claude or OpenAI. No GPU needed. The server is an orchestrator.

## Sharing the host

**The host's firewall is owned by another project, and Docker must not fight it.** That box manages its own `nftables` ruleset from a single hand-written file, which is deliberately the only thing on the machine that touches netfilter.

A default Docker install breaks that arrangement badly. Docker sets the filter `FORWARD` policy to drop and installs its own chains, so two systems end up mutating netfilter state, and reloading either one breaks the other. On a host that only runs containers this is invisible; on this host it is not.

Docker is therefore configured to leave netfilter alone entirely, and the host's own ruleset grants the container bridge what it needs. Three things in **this** repo exist to hold up that arrangement:

| Setting | File | Why it matters |
|---|---|---|
| `com.docker.network.bridge.name: jarvis0` | `docker-compose.yml` | The host's firewall grants access **by interface name**. Docker would otherwise use `br-<hash>` and rename it on every recreate, silently cutting the containers off with no error anywhere — Jarvis would just stop answering |
| Pinned subnet `172.31.240.0/24` | `docker-compose.yml` | A stable, recognisable identity to the host's DNS and firewall, rather than a new unexplained one after each recreate |
| `mem_limit` / `cpus` per service | `docker-compose.yml` | A leak in Jarvis must never starve the services it shares the box with |

**Do not change the bridge name, the subnet, or the `dns:` entries without reading the host's own repository first.** The daemon configuration, the firewall rules, the setup script, and the recovery procedure all live there — deliberately, because that repo is private and this one is public.

## Why not a VPS

A cloud VPS would avoid sharing a host at all, and the docs originally assumed one (DigitalOcean, 4 vCPU / 8 GB, $15–30/month). Against that: the home machine already exists and already runs without interruption, it costs nothing further, and the household's private financial and knowledge data stays on hardware in the house. The measured footprint — 152 MB of RAM against 6.3 GB free — makes the capacity argument moot.

The real cost of the choice is blast radius, and that is what the resource limits and the netfilter arrangement above are for.

## Development environment

Dev and production are the same stack, on ezbox. There is no second copy: `/opt/ai-assistant/src` is bind-mounted into the agent container and Deno runs with `--watch`, so an edit over SSH restarts the agent within seconds.

Two consequences follow:

- **A save during a turn kills that turn**, and the Telegram message that provoked it is lost.
- **`make dev` on the Mac collides with production.** Both would poll the same bot token, Telegram answers 409, and messages are dropped. Stop ezbox's stack first, or use a second bot token.

Deploys run from the Mac against ezbox's Docker daemon over SSH:

```bash
docker context create ezbox --docker "host=ssh://ezbox"   # once
make deploy                                                # pull on ezbox, rebuild, recreate
```

`DOCKER_CONTEXT=ezbox` is exported by the `Makefile` rather than passed as a `--context` flag, so it also reaches `scripts/migrate.sh` and `scripts/trace.sh` and both work unchanged.

**`op run` stays on the Mac.** It resolves each secret and passes it in the container-create call, so no secret file is ever written to the router's disk, and `docs/security.md`'s "no `.env` files" rule survives the move. Deploys need the Mac and 1Password; reboots do not, because `restart: unless-stopped` restarts the containers with the environment already baked in.

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
- Recovery: rebuild the host from its own repository's setup script, retrieve secrets from 1Password, restore from latest backup, `make deploy`. **Max data loss: 24 hours.**

> **None of this exists yet.** `make backup` is a stub that prints "not yet implemented". The database holds two years of Plaid history that Plaid will not re-serve past 730 days, plus the whole knowledge graph, on a single NVMe in a house. This is the largest open gap in the deployment. The host already runs a weekly state backup on a timer, so there is an obvious place to add a nightly `pg_dump` to the Backblaze B2 bucket Jarvis already uses.

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
| Hosting (ezbox — owned hardware, already running as the router) | $0 + a few watts |
| Object storage (archive + backups) | < $1 |
| Embedding API (Gemini `gemini-embedding-001`) | < $1 |
| Transcription API (Deepgram nova-2) | < $1 |
| **Subtotal** | **~$3** |

Hosting on hardware that already runs for another reason is what removes the $15–30 line. The trade is blast radius, not money — see "Living on the router".

### LLM API costs

Assumes Haiku 4.5 for ingestion, Sonnet 4.6 or Opus 4.7 for reasoning. Prompt caching is critical — stable prefix and daily prefix are cached across turns.

| Scenario | Monthly cost |
|---|---|
| **Normal use, Sonnet core** (15 interactions/day, 50 emails/week) | **~$33–48** |
| **Normal use, Opus core** | **~$42–57** |
| **Heavy use, Sonnet core** (30 interactions/day, 100 emails/week) | **~$50–65** |
| **Heavy use, Opus core** | **~$65–80** |

The biggest variable is conversation volume — each additional daily interaction costs ~$0.02 (Sonnet) to ~$0.04 (Opus) with good caching.
