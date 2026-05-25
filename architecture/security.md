# Security Architecture

If the server is compromised, an attacker gains: full relationship graph, financial picture, calendar/location patterns, communication history and style (enough to impersonate you), credentials for every integrated service, and the knowledge graph's inferences about you. This is a dossier, not a simple breach. The system must be treated with the seriousness of medical records or financial credentials.

## Core security principles

### 1. Store everything, protect it aggressively

The system's value comes from having a complete, permanent record you own — financial transactions, full email archives, research artifacts, conversation history. Minimizing storage undermines the core value proposition and leaves you dependent on third-party retention policies. The security posture is about hardening access to a comprehensive store, not reducing what's there. Container isolation, encryption, and strict access controls are the defense — not data minimization.

### 2. Encrypt data at rest with off-server keys

Database volumes encrypted with LUKS. Decryption key stored in a separate secrets manager or fetched from a separate service at boot time. Backups encrypted before leaving the server using a GPG key on your local machine. Even if an attacker compromises both the server and the backup storage, they can't read backups without your local key.

### 3. Segment credentials and blast radius

- **Store all secrets in 1Password.** OAuth tokens, API keys, database credentials, and service passwords live in 1Password — never in `.env` files on disk. The application retrieves secrets at runtime via the 1Password CLI (`op`) or Connect server API. File system compromise alone yields nothing.
- Use short-lived OAuth tokens (not permanent API keys) wherever possible.
- Principle of least privilege: calendar = read-only, email = read-only, no send-as capability.

### 4. Authenticate everything

API server requires authentication on every endpoint, even though it's single-user. Strong API key or JWT over HTTPS.

Entire server behind a **WireGuard VPN** — nothing exposed to the public internet except the VPN endpoint. No public-facing HTTP endpoints. The Postgres port, application server, and monitoring are all VPN-only. All access is via SSH or the ingestion channels (Telegram bot polling, OAuth API polling).

### 5. Treat the LLM API as a data exfiltration channel

Rich personal context is sent to Anthropic/OpenAI with every query. Mitigations:

- Enable zero data retention on LLM APIs.
- Prompt injection defense is critical — see the dedicated section below.

### 6. Audit logging and anomaly detection

Every database query, API call, and LLM interaction logged with timestamps. Logs shipped to an external service (separate from the main server) so an attacker can't delete them.

Anomaly alerts: API calls at unusual hours, spikes in database queries, access from non-VPN IPs.

### 7. Design for breach containment

- Automatic credential rotation — short-lived OAuth tokens expire automatically if the server goes offline.
- Documented **breach runbook**: a checklist executable from your phone that revokes every credential and kills the server.

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

A flag in an external store (a key in 1Password) that the tool-call middleware checks before every execution. When flipped, all tool calls are blocked and the agent session is frozen.

Triggered via the SSH CLI on the server, a Telegram bot command, or by flipping the 1Password flag directly. The CLI is the most reliable path — it doesn't depend on Telegram or 1Password availability.

### Graceful degradation

Not every anomaly requires a full kill. If monitoring detects suspicious behavior, the agent's tool permissions are reduced to read-only mode rather than killed entirely.

## Container isolation model

The system runs as three application containers with strict network and permission boundaries. This is the primary architectural defense — even if one container is fully compromised, the blast radius is contained. See [infrastructure.md](infrastructure.md) for the full container layout.

### Ingestion container

Processes all untrusted external input: emails, Telegram messages, Plaid transactions, web-fetched content, OCR'd documents. This is the highest-risk component — it directly handles attacker-controlled content.

**Web fetch constraint:** The ingestion container fetches URLs only when explicitly instructed by core (user-initiated research requests). It never autonomously follows URLs found in emails, documents, or other ingested content. This breaks the email → URL → prompt injection attack chain. See [ingestion.md](ingestion.md).

**Permissions:**
- Outbound network access to specific external APIs only (Gmail, Telegram, Plaid, LLM API)
- No direct database access — emits structured records to a single Postgres table (`ingestion_emissions`) via a database user with INSERT-only permissions on that one table
- No access to OAuth write tokens, 1Password secrets for other services, or any core system resources
- Separate Docker network from core — communicates only through the emission table

**Emission schema:** Every record the ingestion container emits must conform to a predefined schema — typed fields for entities, facts, events, tasks, embeddings. The core container validates every emission against these schemas before acting on it. Anything that doesn't match is logged and dropped. No free-form text passes through as executable instructions.

**Monitoring:** The core container watches the emission stream for anomalies:
- Volume spikes (emission rate far above normal)
- Schema violations (unexpected fields, malformed types)
- Content anomalies (emissions containing prompt-like patterns, references to system internals, attempts to modify preferences)
- Behavioral anomalies (entity creation patterns that don't match normal ingestion)

If anomalies are detected, the core can kill the ingestion container and alert you via Telegram.

### Sandbox container

Executes LLM-generated TypeScript via Deno inside a locked-down Docker container. Two layers of isolation: Deno's permission system (`--deny-net`, `--deny-env`, scoped `--allow-read`/`--allow-write`) at the application level, and Docker's seccomp profiles + cgroup resource limits at the OS level. See [infrastructure.md](infrastructure.md) for the full sandbox design.

**Permissions:**
- No network access (`--network=none` at Docker level, `--deny-net` at Deno level)
- No database access
- No access to secrets or environment variables
- Receives only a read-only data slice prepared by core (e.g., a CSV of transactions, extracted PDF text)
- Returns structured results via a mounted output volume
- Destroyed and recreated per task — no persistent state between executions

### Core container

The only trusted component. Has full database access, coordinates ingestion and sandbox, handles user interactions, calls LLM APIs for reasoning.

**Core never processes untrusted external content directly.** Web search results and fetched web pages are routed through the ingestion container, not processed by core's LLM calls. Core's Anthropic API calls reason over trusted, already-validated context: knowledge graph data, validated emissions, and user messages. This ensures that prompt injection in web content cannot influence an LLM call with full system privileges. See [ingestion.md](ingestion.md).

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

4. **Classifier filter on ingested content.** Before untrusted content enters any LLM prompt, run a lightweight classifier (a second, cheaper model call or a rule-based filter) to detect common injection patterns. This catches the obvious attacks at low cost.

5. **Emission validation in core.** The core container treats all ingestion emissions as untrusted even after schema validation. Emissions that attempt to create preferences or reference system internals go to a review queue rather than applying automatically.

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

