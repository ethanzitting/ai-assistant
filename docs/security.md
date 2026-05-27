# Security Architecture

If the server is compromised, an attacker gains: full relationship graph, financial picture, calendar/location patterns, communication history and style (enough to impersonate you), credentials for every integrated service, and the knowledge graph's inferences about you. This is a dossier, not a simple breach. The system must be treated with the seriousness of medical records or financial credentials.

## Core security principles

### 1. Store everything, protect it aggressively

The system's value comes from having a complete, permanent record you own — financial transactions, full email archives, research artifacts, conversation history. Minimizing storage undermines the core value proposition and leaves you dependent on third-party retention policies. The security posture is about hardening access to a comprehensive store, not reducing what's there. Container isolation, encryption, and strict access controls are the defense — not data minimization.

### 2. Backup and encrypt off-server

Postgres runs on the droplet's local disk — no LUKS, no separate encrypted volume. The threat model doesn't justify the operational complexity: the real risks are application-level compromise and SSH access, not physical disk theft.

**Backup strategy:** Regular pg_dump → GPG-encrypt with a local key → push to Backblaze B2. The file archive (emails, documents, research) already lives on B2. Combined with the git repo for application code and 1Password for credentials, a Postgres backup is sufficient for full recovery. Audit logs live in Postgres, so they're captured by pg_dump automatically.

Even if an attacker compromises both the server and B2, they can't read backups without the GPG key on your local machine.

**B2 deletion protection:** The application uses a B2 application key scoped to `writeFiles` and `readFiles` only — no `deleteFiles` capability. A separate admin key with full permissions stays in 1Password but is never available to the application. Even full server compromise cannot delete backups or archived files. B2 Object Lock can be enabled on the backup bucket for additional retention guarantees (files cannot be deleted by anyone until the retention window expires).

### 3. Segment credentials and blast radius

- **Store all secrets in 1Password.** OAuth tokens, API keys, database credentials, and service passwords live in 1Password — never in `.env` files on disk. The application retrieves secrets at runtime via the 1Password CLI (`op`) or Connect server API. File system compromise alone yields nothing.
- Google integrations use OAuth 2.0 with refresh tokens stored in 1Password. Access tokens expire hourly and are refreshed automatically by application code — no user interaction needed after initial authorization.
- Principle of least privilege: calendar = read-only, email = read-only, no send-as capability.

### 4. Authenticate everything

API server requires authentication on every endpoint, even though it's single-user. Strong API key or JWT over HTTPS.

Entire server behind a **WireGuard VPN** — nothing exposed to the public internet except the VPN endpoint. No public-facing HTTP endpoints. The Postgres port, application server, and monitoring are all VPN-only. All access is via SSH or the ingestion channels (Telegram bot polling, OAuth API polling).

### 5. Treat the LLM API as a data exfiltration channel

Rich personal context is sent to Anthropic/OpenAI with every query. Mitigations:

- Enable zero data retention on LLM APIs.
- Prompt injection defense is critical — see the dedicated section below.

### 6. Audit logging and anomaly detection

Every database query, API call, and LLM interaction logged to Postgres with timestamps. Audit logs are structured rows (timestamp, action type, context, outcome) — compact enough that years of single-user activity fit comfortably in the database. Captured by pg_dump alongside everything else, so backups cover the full audit trail.

Anomaly alerts: API calls at unusual hours, spikes in database queries, access from non-VPN IPs.

### 7. Design for breach containment

- Automatic credential rotation — short-lived OAuth tokens expire automatically if the server goes offline.
- **Breach runbook** — a checklist executable from your phone when the server is fully compromised:
  1. **Kill the droplet** from DigitalOcean's control panel (mobile app or web)
  2. **Revoke OAuth tokens** — Google security settings for Gmail/Calendar, Telegram for the bot token
  3. **Revoke the Anthropic API key** — stops LLM usage on your account
  4. **Rotate the 1Password service account token** — invalidates any cached credentials
  
  Each step is independent. The on-server kill switch (SSH CLI, 1Password flag) is useless if the server itself is compromised — these external revocations are the real emergency stop.

## Agent safety controls

Runtime safety controls that the agent cannot bypass. These are hardcoded safeguards, not a dynamic permission system.

### Circuit breakers (automated)

A middleware wrapper around every tool call the agent makes. Before execution, check:

- **Budget caps.** Token spend, API call count, and database write count per session and per time window. Trip if exceeded.
- **Loop detection.** More than N identical tool calls within a short window indicates a runaway loop. Trip immediately.
- **Scope enforcement.** Allowlist of permitted tool calls. Any call outside the list is blocked and logged.
- **Rate limiting.** Maximum operations per minute to prevent rapid-fire damage.

These are fast, stateless checks — not LLM calls. A few conditionals in the middleware, checked on every tool invocation.

### Kill switch (manual)

A flag in an external store (a key in 1Password). A background process polls the flag every 60 seconds and caches the state locally. The tool-call middleware checks the local cache — no network round-trip per tool call. When the flag is flipped, all tool calls are blocked within 60 seconds and the agent session is frozen.

**Fail-closed:** if 1Password is unreachable, the system treats the kill switch as engaged. Better to pause than to run without a kill switch.

Triggered via the SSH CLI on the server, a Telegram bot command, or by flipping the 1Password flag directly. The CLI is the most reliable path — it writes the local cache directly, taking effect immediately without waiting for the next 1Password poll.

### Graceful degradation

Not every anomaly requires a full kill. If monitoring detects suspicious behavior, the agent's tool permissions are reduced to read-only mode rather than killed entirely.

## Container isolation model

The system runs as three application containers with strict network and permission boundaries. This is the primary architectural defense — even if one container is fully compromised, the blast radius is contained. See [infrastructure.md](infrastructure.md) for the full container layout.

### Ingestion container

Processes all untrusted external input: emails, Telegram messages, Plaid transactions, web-fetched content, OCR'd documents. This is the highest-risk component — it directly handles attacker-controlled content.

**Web fetch constraint:** The ingestion container fetches URLs only when explicitly instructed by the agent (user-initiated research requests). It never autonomously follows URLs found in emails, documents, or other ingested content. This breaks the email → URL → prompt injection attack chain. See [ingestion.md](ingestion.md).

**Permissions:**
- Outbound network access to specific external APIs only (Gmail, Telegram, Plaid, LLM API) — enforced by Deno `--allow-net` allowlist and Docker network rules
- No subprocess execution — Deno `--deny-run` prevents spawning child processes, CLI scripts, or shell commands
- Read-only filesystem (`docker run --read-only`) with specific writable mount points only
- No direct database access — emits structured records to a single Postgres table (`ingestion_emissions`) via a database user with INSERT-only permissions on that one table
- No access to OAuth write tokens, 1Password secrets for other services, or any agent system resources
- Separate Docker network from the agent — communicates only through the emission table
- The agent discovers new emissions by polling `ingestion_emissions` for unprocessed rows (every 5-10 seconds)

**Emission schema:** Every record the ingestion container emits must conform to a predefined schema — typed fields for entities, facts, events, tasks, embeddings. The agent validates every emission against these schemas before acting on it. Anything that doesn't match is logged and dropped. No free-form text passes through as executable instructions.

**Container monitoring:** Core actively watches the ingestion container for signs of compromise or exploitation attempts:

- **Permission denial log watching.** Core tails the ingestion container's stderr via Docker's log API. Deno writes `PermissionDenied` errors when anything attempts an unauthorized action (network call to an unlisted domain, subprocess spawn, filesystem write outside allowed paths). Any permission denial triggers an immediate Telegram alert — it means a prompt injection is actively attempting exploitation.
- **Network connection auditing.** Core periodically inspects active network connections from the ingestion container via Docker's API. Expected connections: Gmail API, Calendar API, Anthropic API, the Postgres emission table. Any connection to an unexpected destination is flagged and alerted.
- **Process auditing.** Core periodically checks the ingestion container's process list. Only Deno should be running. Any additional process indicates something bypassed `--deny-run`, which warrants killing the container immediately.

**Emission stream monitoring:** Core also watches the emission data for anomalies:
- Volume spikes (emission rate far above normal)
- Schema violations (unexpected fields, malformed types)
- Content anomalies (emissions containing prompt-like patterns, references to system internals, attempts to modify preferences)
- Behavioral anomalies (entity creation patterns that don't match normal ingestion)

If any monitoring detects anomalies, the agent kills the ingestion container and alerts you via Telegram.

### Sandbox container

Executes LLM-generated TypeScript via Deno inside a locked-down Docker container. Two layers of isolation: Deno's permission system (`--deny-net`, `--deny-env`, scoped `--allow-read`/`--allow-write`) at the application level, and Docker's seccomp profiles + cgroup resource limits at the OS level. See [infrastructure.md](infrastructure.md) for the full sandbox design.

**Permissions:**
- No network access (`--network=none` at Docker level, `--deny-net` at Deno level)
- No database access
- No access to secrets or environment variables
- Receives only a read-only data slice prepared by the agent (e.g., a CSV of transactions, extracted PDF text)
- Returns structured results via a mounted output volume
- Destroyed and recreated per task — no persistent state between executions

### Agent container

The only trusted component. Coordinates ingestion and sandbox, handles user interactions, calls LLM APIs for reasoning.

**Database permissions enforce append-only at the Postgres level.** The agent's database role has SELECT, INSERT, and UPDATE on knowledge graph tables (entities, relationships, facts) — no DELETE, no TRUNCATE. This means "every write is an append" (principle #3 in [vision.md](vision.md)) is enforced by the database, not just application code. UPDATE is needed for setting `valid_until` timestamps on superseded facts. DELETE is granted narrowly only on tables that require it (e.g., `ingestion_emissions` for clearing processed rows). The backup script runs as a separate Postgres superuser role not accessible to the application.

**The agent never processes untrusted external content directly.** Web search results and fetched web pages are routed through the ingestion container, not processed by the agent's LLM calls. The agent's Anthropic API calls reason over trusted, already-validated context: knowledge graph data, validated emissions, and user messages. This ensures that prompt injection in web content cannot influence an LLM call with full system privileges. See [ingestion.md](ingestion.md).

**Sole authority for:**
- Database writes (beyond the ingestion emission table)
- Knowledge graph updates
- Task and project state changes
- Preference modifications
- OAuth token management (via 1Password)

## Prompt injection defense

Prompt injection is the #1 vulnerability in LLM applications and the threat is especially acute for a system that ingests emails, documents, OCR'd mail, and voice transcripts — all of which become indirect injection vectors.

### Defense-in-depth stack

1. **Container separation.** The ingestion container processes all untrusted content in isolation — emails, documents, web search results, and fetched web pages. Even if an injected prompt fully controls the ingestion LLM, it can only emit structured records through the schema-validated emission channel — it cannot trigger actions, read the knowledge graph, or access other services. Core never processes untrusted external content directly, so prompt injection cannot reach a privileged LLM call. This is the most important layer.

2. **Structural prompt separation.** All ingested content (emails, documents, transcripts, OCR output) is placed in clearly delimited data sections of the prompt with explicit system instructions that this content is data, not instructions. Use Anthropic's and OpenAI's structured prompt patterns for this.

3. **Output schema validation.** Constrain agent outputs to structured formats (typed tool calls, JSON schemas) wherever possible. Freeform output is where injection payloads produce the most damage.

4. **Self-hosted injection classifier.** Before untrusted content enters any LLM prompt, run a self-hosted prompt injection classifier (Prompt Guard 2 86M or similar, ~86M params, runs on CPU) to assign a risk score. The classifier does not gate content — it tags it. High-risk content gets processed with a hardened system prompt that treats the content as adversarial and restricts extraction to factual data only. This avoids false-positive drops (security newsletters discussing injection would trigger a binary filter) while giving the ingestion LLM a signal to be more skeptical. A second independently-trained classifier (e.g., ProtectAI deberta-v3-base-prompt-injection-v2) can be added in series to reduce false positives further — risk scores multiply, so two 1% FPR classifiers yield ~0.01% combined FPR.

5. **Emission validation in the agent.** The agent treats all ingestion emissions as untrusted even after schema validation. Emissions that attempt to create preferences or reference system internals are logged and dropped. All knowledge graph writes are append-only — bad extractions are corrected by superseding the fact, never by deleting it.

### Specific risk: email ingestion

The email pipeline is the highest-risk injection surface. An attacker who knows the system exists can send a crafted email containing instructions designed to manipulate the agent's behavior when the email is processed. The email triage classifier should be the most conservative component in the system — when in doubt, classify as noise and discard.

## The 2FA interception attack

**Critical threat.** If the assistant has email read access, and your accounts use email-based 2FA, an attacker who compromises the server can intercept password reset codes and 2FA codes through the assistant's email integration — effectively using your own assistant as a skeleton key for every account.

### Mitigations

1. **Move all 2FA off channels the assistant can see.** Use hardware security keys (YubiKey) or TOTP authenticator apps for everything important. Your second factor must travel through a channel the assistant has zero access to.

2. **Email integration should be blind to auth codes.** Filter at the ingestion level: emails from `noreply@` addresses containing "verification code," "reset your password," "one-time code," etc. are classified as security-sensitive and excluded from processing entirely. Never stored, never summarized, never embedded. This is enforced in the [email triage pipeline](data-lifecycle.md).

3. **Scope email tokens narrowly.** Use Gmail label/category filtering. Route all security-related emails to a separate address the assistant never touches via Gmail filters.

4. **Eliminate real-time email interception.** Poll on a delay (every 15-30 minutes) rather than real-time push. Or design email triage as a batch job you trigger manually, with the token expiring after processing.

5. **Use separate email addresses.** Your assistant monitors `you@yourdomain.com`. Your bank, brokerage, infrastructure passwords, and primary Google/Apple account use a completely separate `secure@yourdomain.com` that the assistant has no credentials for. The attacker can own your assistant's email token completely and still can't receive password reset emails for your bank.

6. **Monitor OAuth token usage.** Google Workspace and Microsoft 365 support audit logging independent of your server. Flag anomalous token usage: reads outside normal polling schedule, keyword searches the assistant would never make.

