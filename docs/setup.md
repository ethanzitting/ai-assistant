# Setup

Everything needed to get the system running locally or recover from a catastrophic loss. Written for future-you who has forgotten the details.

> **Note:** This guide covers the full target setup. Items marked *(not yet implemented)* are documented for future reference — the current system runs Phases 1-3 and 5 (Postgres, agent container, knowledge graph, event engine, Telegram bot, audio/video transcription via Deepgram, B2 archival). See [version-one.md](development/version-one.md) for phase status.

## Prerequisites

Install these before anything else:

- **Docker** and **Docker Compose** (Docker Desktop on Mac includes both)
- **1Password CLI** (`op`) — [developer.1password.com/docs/cli](https://developer.1password.com/docs/cli)
- **Deno** — [deno.land](https://deno.land) (runtime for all application containers, also useful for local scripting)

## 1Password vault setup

All secrets live in 1Password. The application retrieves them at runtime via `op run`. No `.env` files ever touch disk.

Create a vault (or use an existing one) with these items:

| Item | Fields |
|---|---|
| **FIREWORKS_API_KEY** | `notesPlain` |
| **Deepgram** | `api_key` — for audio/video transcription with speaker diarization |
| **Mistral** | `api_key` — for photo/document OCR |
| **Gemini** | `api_key` — for embeddings (semantic search over the knowledge graph and archives) |
| **Google OAuth** | `client_id`, `client_secret`, `refresh_token` (populated after the OAuth flow below) |
| **Telegram Bot** | `bot_token` |
| **Postgres** | `username`, `password`, `database` |
| **Backup Encryption** | `gpg_key_id` (the GPG key used to encrypt backups — the private key itself should also be stored in 1Password as a recovery measure) |
| **B2 App Key** | `key_id`, `application_key` — scoped to `writeFiles` and `readFiles` only, no `deleteFiles`. This is the key the application uses |
| **B2 Admin Key** | `key_id`, `application_key` — full permissions including delete. Never available to the application, used only for manual maintenance |
| **Kill Switch** | `enabled` (boolean flag polled by the agent) |

The exact 1Password item names and vault paths are defined in `.env.tpl` — that file is the source of truth for how secrets map to environment variables. If you rename items, update `.env.tpl` to match. The application only has access to the **B2 App Key** — the admin key is for your use only.

## Google OAuth

Google APIs (Gmail, Calendar, Drive) require OAuth 2.0 — there are no long-lived API keys for user data. The authorization flow runs once on your laptop and produces a refresh token that the server uses indefinitely.

### One-time setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project (or reuse one)
3. Enable the **Gmail API**, **Google Calendar API**, and **Google Drive API**
4. Create OAuth 2.0 credentials (Desktop application type)
5. Download the client ID and client secret, store in the 1Password **Google OAuth** item
6. Run `make auth-google` locally — this opens a browser, you click "Allow," and the script stores the resulting refresh token in 1Password

The refresh token does not expire unless you revoke it or change OAuth scopes. The application code automatically refreshes the short-lived access token (expires hourly) using the refresh token — no user interaction needed.

### Re-authorization

Only needed if:
- You revoke the token in [Google security settings](https://myaccount.google.com/permissions)
- You add new OAuth scopes (e.g., adding Drive after initially only using Calendar)
- Google forces a re-auth (rare, usually after a security incident)

Run `make auth-google` again.

## Telegram bot

1. Open Telegram, message [@BotFather](https://t.me/BotFather)
2. Send `/newbot`, follow the prompts, choose a name
3. Copy the bot token, store in the 1Password **Telegram Bot** item
4. Send `/setprivacy` to BotFather, select your bot, set to **Disable** (so the bot can see all messages in groups, if you ever use that)

The bot uses long polling — no webhooks, no public endpoints needed.

## First run (local development)

```bash
git clone <repo-url>
cd ai-assistant
make dev
```

This runs `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` with secrets injected via `op run`. On first start:

1. Postgres container initializes and runs all migrations from `migrations/`
2. Agent container starts with `--watch` for hot-reloading
3. Telegram bot begins long-polling and listens for messages

Verify it works:
- Check logs: `make logs`
- Open a psql shell: `make db`
- Send a message to your Telegram bot — it should respond

## Database migrations

Schema changes are numbered SQL files in `migrations/`, run in order on startup. To add a schema change: create the next numbered file, run `make migrate`. See the root [README.md](../README.md) for migration rules and deployment procedures.

## Seeding initial data

After first run, populate the system with baseline data:

- **Contacts:** seed your key relationships into the knowledge graph (entities + relationships + facts). A seed script or SQL file for this.
- **Calendar:** trigger the first Google Calendar sync to pull in upcoming events. *(Version 2 — not yet implemented.)*
- **Skills:** insert initial skills into the skills table.
- **Test events:** create a few reminders and recurring events to verify the event engine.

## Deploying to ezbox

Jarvis runs on `ezbox`, an always-on Linux box on the home LAN, reached over Tailscale.

**That host runs other services and owns its own firewall.** Read "Sharing the host" in [infrastructure.md](infrastructure.md) before you begin — a default Docker install would fight the host's `nftables` ruleset and break more than Jarvis.

On the host, once — the setup script lives in **that host's own (private) repository**, not here. It preseeds `/etc/docker/daemon.json` so Docker never manages netfilter, installs Docker, verifies Docker claimed no rules, reloads the host ruleset, and clones this repo to `/opt/ai-assistant`.

On the Mac, once:

1. `docker context create ezbox --docker "host=ssh://ezbox"`

Then, to deploy:

2. `make migrate`, then `make deploy`
3. Verify: `make logs`, send a Telegram message, confirm the scheduler runs
4. Confirm the host's other services are unharmed — see its own repo for that checklist

**No 1Password CLI is installed on the host and none is needed.** `op run` stays on the Mac and passes the secrets in the container-create call over the SSH context, so nothing sensitive is written to the host's disk. Access is over Tailscale (`ssh ezbox`), key only.

## Backups

### Automated (production)

A cron job runs daily:

1. `pg_dump` the entire database (knowledge graph, events, tasks, audit logs, embeddings — everything)
2. Compress with gzip
3. Encrypt with GPG using the key ID from 1Password
4. Upload to Backblaze B2
5. Record a metrics snapshot alongside the backup: entity count, fact count, event count, backup file size, SHA256 hash — stored as a JSON file in B2 next to the backup
6. Compare metrics against the previous backup. Alert via Telegram if counts dropped unexpectedly, file size shrank significantly, or any table went to zero. The knowledge graph is append-only, so counts should only go up.

### Weekly verification

A weekly cron job verifies the latest backup end-to-end:

1. Download the most recent backup from B2
2. Decrypt and decompress
3. Restore to a temporary Postgres Docker container
4. Run the same metric queries and compare against the stored metrics snapshot
5. Tear down the temporary container

This catches failures that daily metrics can't: corrupted GPG output, truncated uploads, B2 storage issues, broken SQL. Takes ~30 seconds at expected data sizes. Once a month, verify a backup from 30 days ago instead of the latest to confirm B2 retention.

### Manual

Run `make backup` to trigger a backup immediately. *(Not yet implemented — Phase 7.)*

### Restoring from backup

1. Download the backup from B2
2. Decrypt: `gpg --decrypt backup.sql.gz.gpg | gunzip > backup.sql`
3. Provision a new Postgres instance (or use the existing one)
4. Restore: `psql < backup.sql`
5. Verify: check entity counts against the metrics snapshot for that backup

## Makefile reference

```makefile
dev:          # Start dev environment with hot-reload
up:           # Start production-like environment
down:         # Stop everything
logs:         # Tail all container logs
db:                # Open psql shell
migrate:           # Run pending migrations
reembed:           # (Re)embed null/stale rows — migration, outage recovery, or model change
backfill-archives: # One-time: embed text of already-archived files into document_chunks
backup:            # Manual backup trigger
auth-google:       # Run Google OAuth flow, store refresh token (not yet implemented)
test:              # Run test suite
```

## Recovery checklist

If you're reading this because everything is broken:

1. **Jarvis silent?** `ssh ezbox`, then `make logs` from the Mac. The containers restart themselves after a reboot or a power cut, so silence usually means a crash loop, not a stopped host.
2. **Something on the host's network broke after a Jarvis change?** The host's ruleset is reloadable in one command and restores a known-good state — see its own repository. Reach the box over Tailscale rather than the LAN when doing this.
3. **Host dead?** Restore the host from its own repository first, since Jarvis is not the only thing running on it. Then restore the database from backup and `make deploy`.
4. **Database corrupted?** Restore from the latest backup. **`make backup` is still a stub**, so check what backup actually exists before relying on this line.
5. **Credentials compromised?** Follow the breach runbook in [security.md](security.md) — revoke OAuth, revoke API keys, rotate the 1Password items.
6. **Forgot how something works?** Start with [README.md](README.md) for the reading order, then the specific doc for that concern.
