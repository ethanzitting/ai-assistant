# AI Assistant

A personal AI assistant that understands the full context of your life, proactively surfaces what matters, and gets smarter over time. Built by you, for you — not a product, personal infrastructure.

**Setting up the project?** Start with [docs/setup.md](docs/setup.md).

## Docs

Living architecture and operational docs. Each file covers one concern and is meant to be refined independently.

### Reading order

1. [vision.md](docs/vision.md) — what we're building and why
2. [trust-model.md](docs/trust-model.md) — how much autonomy the assistant has
3. [primitives.md](docs/primitives.md) — the seven conceptual building blocks
   - [event-engine.md](docs/event-engine.md) — scheduling, reminders, recurrence models (split from primitives)
4. [data-architecture.md](docs/data-architecture.md) — storage layers and retrieval
5. [data-lifecycle.md](docs/data-lifecycle.md) — how data ages and gets compressed
6. [context-assembly.md](docs/context-assembly.md) — how stored data becomes prompt context
7. [ingestion.md](docs/ingestion.md) — what comes in, and what doesn't
8. [interfaces.md](docs/interfaces.md) — how the assistant talks to you
9. [infrastructure.md](docs/infrastructure.md) — where it runs and what it costs
10. [security.md](docs/security.md) — threat model and defenses
11. [roadmap.md](docs/development/roadmap.md) — phased build plan

### Development

- [version-one.md](docs/development/version-one.md) — Version 1 implementation plan (8 phases)
- [version-two.md](docs/development/version-two.md) — Version 2 implementation plan (9 phases)

### Operational

- [setup.md](docs/setup.md) — prerequisites, installation, deployment, recovery

### Reference

- [landscape.md](docs/landscape.md) — competitive context

### Code

- [AGENTS.md](AGENTS.md) — architecture, subsystems, database, file layout, and coding conventions

## Shipping changes

Jarvis runs on **ezbox**, an always-on Linux box on the home LAN. The `Makefile` drives ezbox's Docker daemon over SSH, so `make` commands run from the Mac and act on ezbox. That host runs other services and owns its own firewall — see [infrastructure.md](docs/infrastructure.md) before changing anything about networking.

### Code changes (no schema change)

`/opt/ai-assistant/src` on ezbox is bind-mounted into the agent, which runs `deno --watch`. **A code edit needs no deploy at all** — save it and the agent restarts.

1. Edit `/opt/ai-assistant/src` over `ssh ezbox`
2. Watch it reload: `make logs`
3. Commit and push from ezbox, then `git pull` on the Mac to stay in sync

**Do not save during a turn.** The reload kills the turn in flight and loses that Telegram message.

For a Dockerfile, compose, or env change, a rebuild is needed: `make deploy`. Postgres data is on a persistent volume — recreating containers doesn't touch it. The in-memory event queue is lost on restart, but pending reminders and events are in Postgres and will be picked up when the event processing loop starts again.

### Database schema changes

**Never modify a migration that has already been applied.** Always create a new numbered migration file.

1. Write the new migration: `migrations/NNN_description.sql`
2. **Take a manual backup first.** Schema migrations are the most common cause of data loss — always have a restore point. `make backup` is still a stub, so dump by hand: `docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > backup.sql.gz`
3. `make migrate`, verify with `make db`
4. Commit and push

If the migration fails partway through, restore from the backup you just took. Do not attempt to fix a half-applied migration by hand unless you are certain you understand the state.

**Rules for writing migrations:**

- Use `IF NOT EXISTS` for CREATE statements so migrations are idempotent
- Adding a column: use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` with a DEFAULT so existing rows are populated
- Renaming or removing a column: do it in two steps across two deploys. First deploy: add the new column, backfill data, update code to write to both. Second deploy: drop the old column. This prevents downtime if you need to roll back the first deploy.
- Adding an index: use `CREATE INDEX CONCURRENTLY` to avoid locking the table (matters less at this scale but good habit)
- Never use `DROP TABLE` or `TRUNCATE` in a migration — the append-only principle applies to the schema too

### Skills changes

Skills live in the database, not in code. To update a skill:

```sql
UPDATE skills SET body = '...', updated_at = now() WHERE name = 'skill_name';
```

No migration, no deploy, no restart. Takes effect on the next time the agent fetches the skill.

### Rollback

If a deploy breaks things:

1. `git revert` the commit, push, redeploy — for code changes
2. Restore from the pre-migration backup — for schema changes
3. Both — if the deploy included both code and schema changes

The daily backup runs once per day. If you deploy twice in a day and the second deploy breaks things, the daily backup may be from before *both* deploys. Always `make backup` before risky changes.

## Conventions

- One concern per file. If a file grows past ~400 lines, split it.
- Cross-link with relative markdown links so refactors are cheap.
- Mark unresolved questions with `> **Open question:** ...` blockquotes so they're easy to grep.
- Mark decisions with `> **Decision (YYYY-MM-DD):** ...` so the rationale survives.
