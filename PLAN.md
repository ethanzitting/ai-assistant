# Project AEGIS: AI-Powered Personal Life Assistant

## Comprehensive Architecture & Implementation Plan

*Generated from extended planning session â€” May 2026*

---

## 1. Vision

Build a personal AI assistant that approaches the usefulness of a skilled human assistant â€” one that understands the full context of your life, proactively surfaces what matters, and gets smarter over time. The system is built by you, for you: opinionated, tailored, and incrementally extensible. It is not a product; it is personal infrastructure.

The assistant should reduce the cognitive overhead of life â€” tracking the things you know you should be doing but can't hold in your head simultaneously. It should connect dots across domains (relationships, finances, calendar, health, household) that siloed apps never will.

---

## 2. Feature Domains

### 2.1 Relationship Management
- Maintain a rich model of your personal and professional network: who people are, how you relate to them, what you've discussed, what matters to them.
- Track interaction cadences â€” when you last spoke to someone, how often you typically connect.
- Surface proactive nudges: "You haven't talked to Sarah in 3 weeks. Her birthday is next month. She mentioned possibly moving to Portland."
- Gift and occasion logistics: anniversaries, graduations, birthdays with contextual suggestions.

### 2.2 Calendar & Schedule Management
- Unified view across personal and work calendars.
- Conflict detection â€” not just time overlaps, but logistical conflicts (meeting across town 15 minutes after another meeting).
- Buffer awareness â€” flagging packed days with no breaks.
- Meeting preparation: "You're meeting with James tomorrow. Last time you discussed the Q3 timeline. He had an action item to get back to you on vendor pricing."

### 2.3 Communication Triage & Drafting
- Email triage: flag what's urgent, summarize routine messages, surface buried important items.
- Follow-up tracking: "You emailed the contractor 5 days ago and never heard back. Want me to draft a nudge?"
- Draft replies for routine correspondence in your voice and tone.

### 2.4 Financial Awareness
- Track upcoming bills and due dates.
- Conditional alerts: "Three bills totaling $2,400 land Friday. Checking account balance is $1,800."
- Pattern recognition: recurring charges, unusual transactions, late fee risks.
- No autonomous spending authority â€” observe and inform only.

### 2.5 Travel & Logistics Coordination
- Research and planning (not booking â€” that's a later trust tier).
- Itinerary assembly, confirmation tracking.
- Proactive alerts: passport expiration, visa requirements, schedule conflicts with travel.
- Preference memory: you prefer aisle seats, hate layovers, favor certain airlines.

### 2.6 Document & Information Management
- "Where's that contract we signed with the landscaper?"
- Contextual retrieval across all stored documents and conversations.
- Meeting prep assembly from past interactions and documents.

### 2.7 Health & Wellness Logistics
- Appointment tracking and cadence reminders (dentist every 6 months, annual physical).
- Prescription refill awareness.
- Provider contact and insurance detail storage.
- Not medical advice â€” logistics only.

### 2.8 Household Management
- Recurring maintenance tracking: furnace filter, gutter cleaning, car registration, pet vet appointments.
- The "death by a thousand cuts" tasks that individually are trivial but collectively create enormous mental load.

### 2.9 Project & Goal Tracking
- Higher-level accountability: "You said in January you wanted to read 24 books this year. You're at 6 and it's June."
- Stalled intention detection: "You've been talking about refinancing for 3 months but haven't acted."
- Long-arc goal monitoring across life domains.

### 2.10 Research & Decision Support
- Gather options for decisions (phone plans, contractors, schools).
- Build comparison matrices.
- Present short lists instead of overwhelming open fields.

### 2.11 Proactive Pattern Recognition
- "You've canceled your gym session 3 weeks in a row â€” want to move it to a different slot?"
- "You always seem stressed after your Thursday afternoon meeting block â€” want a buffer?"
- "You keep getting late fees on that one bill â€” should we set up autopay?"

---

## 3. Trust & Autonomy Tiers

All features are categorized into three tiers that govern how much autonomous authority the assistant has.

### Tier 1: Observe & Inform (default for all features at launch)
The assistant watches, tracks, analyzes, and tells you things. Zero risk. Covers reminders, information surfacing, pattern recognition, deadline tracking, briefings.

### Tier 2: Draft & Propose
The assistant prepares actions for your approval. Email drafts, itinerary options, comparison research, meeting prep docs. You pull the trigger.

### Tier 3: Act Autonomously (future â€” requires earned trust)
The assistant schedules, sends messages, or takes actions on your behalf. Limited to low-stakes actions initially (confirming appointments, sending pre-approved messages). No financial transactions without explicit per-action approval.

---

## 4. Core Architectural Primitives

The system is not built as features â€” it's built as composable primitives that features are configured on top of.

### 4.1 The Knowledge Graph ("the memory")
A structured, evolving model of your life. People, places, accounts, preferences, relationships between entities, historical context. "Sarah" isn't just a contact â€” she's your sister, lives in Denver, has two kids (ages 7 and 10), works at a nonprofit, you last spoke May 3rd, and she mentioned thinking about moving. Every other system reads from and writes to this graph.

### 4.2 The Event & Cadence Engine ("the clock")
Handles four distinct temporal patterns:
- **Fixed events:** Dentist appointment June 12 at 2pm.
- **Recurring cadences:** Change furnace filter every 90 days. Check in with Dad every two weeks.
- **Deadline-driven sequences:** Passport expires in 6 months, but renewal should start at the 3-month mark, so the reminder fires then.
- **Conditional triggers:** Remind me based on state changes, not dates. "When checking balance drops below $2,000." "When airfare to Denver drops below $300." "If I haven't heard back from the contractor in 5 days."

### 4.3 The Ingestion & Integration Layer ("the senses")
Connects to external data sources, normalizes data, and feeds it into the knowledge graph and event engine. Supports both structured integrations (APIs, OAuth) and unstructured parsing (extracting a date from a school email). The trust tiers live here architecturally: Tier 1 = read-only access, Tier 2 = prepare actions, Tier 3 = write access.

### 4.4 The Reasoning & Prioritization Layer ("the judgment")
LLM-powered core that transforms raw information into actionable intelligence. Handles triage, conflict detection, pattern recognition, synthesis, and relevance filtering. Knows not just that three bills total $2,400 and your balance is $1,800, but that this is a problem requiring your attention.

### 4.5 The Communication Interface ("the voice")
How the assistant talks to you and how you talk to it. Manages both inbound (your questions, instructions, corrections) and outbound (proactive surfacing). Critical design decision: modality and timing. Some things are a morning briefing, some are immediate alerts, some wait until asked. Multiple output channels: smart glasses (Even Realities G2) for quick contextual nudges, phone for richer interactions, desktop for full working sessions.

### 4.6 The Preference & Feedback Loop ("the learning")
Captures every correction, override, and expressed preference and feeds it back into the knowledge graph and reasoning layer. "Don't remind me about that on weekends." "That email was actually important, not low priority." "I liked that restaurant suggestion." Explicit mechanism for the assistant to get better over time.

---

## 5. Technical Architecture

### 5.1 Data Layer Overview

The system uses a multi-layer storage architecture where different types of memory live at different levels, and only the relevant slice gets pulled into the LLM's context window for any given interaction.

#### Layer 1: Structured Database (Postgres)
Standard relational data â€” contacts, accounts, recurring events, preferences, transaction history. When the assistant needs "what bills are due this Friday," it runs a database query. No AI involved in the retrieval. The LLM reasons about the data once retrieved, not to find it.

#### Layer 2: Vector Store (pgvector)
Stores embeddings â€” numerical representations of text that capture semantic meaning. Conversations, notes, emails, and documents are chunked, embedded via an embedding model (OpenAI text-embedding-3-small or equivalent), and stored with metadata. At query time, the user's question is embedded and compared against stored chunks to find semantically similar content. This is the core of RAG (Retrieval Augmented Generation).

Best practice: hybrid search combining keyword-based search (BM25) with vector/semantic search delivers significant relevance gains over either method alone.

pgvector runs as a Postgres extension â€” no separate database needed. Documents and embeddings live in the same table, same transaction, no sync issues.

Two logical partitions within pgvector:
- **Active index:** Embeddings of current summaries and recent full-text content. Lean, pruned, fast. What the daily reasoning layer queries.
- **Archive index:** Embeddings of every original document chunk, ever. Larger, but still well within pgvector's capabilities. Searched when deeper retrieval is needed.

#### Layer 3: Knowledge Graph (Neo4j + Graphiti)
Handles relationships and temporal reasoning that vector search can't. "Who does Sarah work with?" and "What changed about my finances between January and March?" require understanding connections between entities and how facts evolve over time.

**Graphiti** (by Zep AI, open source) is the temporal knowledge graph engine. Key properties:
- Autonomously builds context graphs from unstructured and structured data.
- Facts have validity windows â€” when information changes, old facts are invalidated, not deleted.
- Can query what's true now or what was true at any point in time.
- Combines semantic embeddings, keyword search, and graph traversal for low-latency retrieval (P95 ~300ms) without requiring LLM calls during retrieval.
- Supports Anthropic Claude as well as OpenAI for inference.
- Uses "episodes" as the primary unit of information â€” text or structured JSON automatically processed to extract entities and relationships.

#### Layer 4: Hierarchical Summarization
Progressive compression of older data. Recent interactions stored verbatim, older ones summarized into denser representations. Like human memory: yesterday's conversation in detail, last week's in broad strokes, six months ago as key takeaways. This cuts token costs by 80-90% while potentially improving response quality by removing noise.

### 5.2 The Archive (permanent source-of-truth)

**Critical architectural principle: the knowledge system is a cache, not a replacement. The originals are the source of truth.**

Every piece of raw data â€” every email, PDF, transcript, LLM interaction log â€” is archived to object storage (S3 or Backblaze B2) before any processing happens. Nothing gets summarized, embedded, or added to the knowledge graph until the original is safely archived. If the processing pipeline crashes halfway through, nothing is lost.

Archive organization:
```
archive/
â”œâ”€â”€ 2026/
â”‚   â”œâ”€â”€ 01/
â”‚   â”‚   â”œâ”€â”€ emails/
â”‚   â”‚   â”‚   â””â”€â”€ 2026-01-15T09:32:00Z_from-sarah_re-new-job.json
â”‚   â”‚   â”œâ”€â”€ documents/
â”‚   â”‚   â”‚   â””â”€â”€ 2026-01-20_tax-w2-employer.pdf
â”‚   â”‚   â”œâ”€â”€ transcripts/
â”‚   â”‚   â”‚   â””â”€â”€ 2026-01-22T10:00:00Z_project-standup.md
â”‚   â”‚   â””â”€â”€ llm-logs/
â”‚   â”‚       â””â”€â”€ 2026-01-15T08:00:00Z_morning-briefing.json
â”‚   â””â”€â”€ 02/ ...
```

Each archived item includes metadata: ingestion timestamp, data type, entities involved, processing applied, and a unique ID (`source_ref`) linking it to all derived artifacts in the knowledge system. Every summary, every knowledge graph fact, every embedding traces back to its archived original.

**Storage economics:** A year of heavy personal use (20,000 emails, 200 PDFs, 100 transcripts, thousands of LLM logs) is ~2-5GB of raw data. On Backblaze B2, that's ~$0.03/month. Even after 10 years, storage costs are under $1/month. There is no financial reason to delete originals, ever.

**Retrieval modes:**
- **Targeted:** Know roughly what you're looking for. The knowledge system identifies relevant `source_ref` IDs, fetches specific files from the archive.
- **Exploratory:** Full natural-language search over originals via the archive embedding index. For legal, audit, or dispute scenarios where summaries may not be sufficient.

**Reprocessing capability:** If a better embedding model or entity extraction tool emerges, the entire archive can be reprocessed through an improved pipeline. The archive is the immutable foundation; everything else is a derived view that can be rebuilt.

### 5.3 Query-Time Context Assembly

When the assistant receives a query â€” e.g., "I'm seeing Sarah next week, help me prepare" â€” the system:

1. Hits the **structured database**: Sarah's contact record, upcoming events, last interaction date. Cheap, fast, zero tokens.
2. Queries the **knowledge graph**: Sarah's relationships, temporal state, related entities. Graph traversal, no LLM calls.
3. Does a **vector search**: "conversations with Sarah" filtered by recency, pulling the 3-5 most relevant chunks.
4. Pulls a **compressed summary** of broader history with Sarah if one exists.

All assembled into a prompt â€” maybe 2,000-4,000 tokens of highly relevant context. The LLM reasons over a carefully curated slice, not 100K tokens of raw history. This is "context engineering" â€” the art of getting the right information into the smallest prompt.

---

## 6. Data Lifecycle: Ingestion, Processing, Pruning

### 6.1 Three-Tier Memory Model

- **Hot memory** (0-2 weeks): Full-fidelity recent data, stored verbatim.
- **Warm memory** (2 weeks - 6 months): Summarized and distilled. Individual items compressed into meaningful takeaways, raw text deleted.
- **Cold memory** (6+ months): Knowledge graph facts only. Extracted relationships, patterns, decisions â€” no source material attached. Tiny and structurally important.

Data flows downward through tiers over time, getting smaller and denser. The archive retains originals at full fidelity outside this tier system.

### 6.2 Processing by Data Type

#### Emails
1. **Triage classification** (rule-based + lightweight LLM):
   - *Security-sensitive* (2FA, password resets): Immediately discarded, never stored.
   - *Transactional noise* (shipping, receipts, automated notifications): Extract structured data (tracking number, arrival date), write to event system, discard body.
   - *Informational* (newsletters, announcements): Generate 2-3 sentence summary, extract dates/action items, embed summary, discard original body.
   - *Relational* (human communication): Full processing â€” hot storage of full text, entity/fact extraction for knowledge graph, embedding generation, relationship metadata update.
2. **Pruning at 2 weeks:** LLM summarization pass. Summary replaces full text. Embedding regenerated from summary.
3. **Pruning at 6 months:** Further compression into relationship summary documents ("March 2026: Sarah emailed about new role at [company], seemed excited"). Individual summary deleted; insight absorbed into relationship summary. Knowledge graph facts persist indefinitely.

#### PDFs and Documents
- **Legal/financial** (contracts, tax forms, insurance): Stored permanently in archive. Key metadata extracted to structured storage. Deadlines fed to event engine. Never pruned.
- **Reference** (manuals, guides, research): Chunked and embedded for vector search. Original kept in archive. If not retrieved in queries for 1+ year, active-index chunks can be pruned.
- **Ephemeral** (menus, flyers, one-time informational): Extract dates/facts, push to event engine/knowledge graph, discard from active storage after short retention. Archive retains original.

#### Transcripts (meetings, conversations, voice notes)
1. **Immediate structured extraction** (high-value LLM call):
   - Meeting summary (high-level overview)
   - Action items (who committed to what, by when)
   - Decisions made (anything agreed upon)
   - Key facts and entity updates
   - Relationship signals (who was present, dynamics, tension, enthusiasm)
2. Action items â†’ task/event system. Decisions â†’ decisions log. Entity updates â†’ knowledge graph. Summary + full transcript â†’ embedded for vector search.
3. **Pruning at 1 month:** Compressed summary generated (~500 words from 10,000-word transcript). Verify all action items and decisions already extracted. Delete full transcript from active storage.
4. **Pruning at 6 months:** Compressed summary folded into periodic summary ("Q1 2026 project meetings: key themes were X, Y, Z; major decisions included A, B, C"). Individual summary deleted. Action items and decisions persist as standalone records.

#### LLM Interaction Logs
1. Full interaction logged: query, assembled context, prompt, response, feedback.
2. **Pruning at 1 month:** Classify each interaction. Discard routine ones ("what's on my calendar today?"). Keep interactions containing preference signals, corrections, or substantive decisions.
3. **Preference distillation:** Preference-bearing interactions converted to explicit preference records in the knowledge graph ("User prefers not to be reminded about gym on weekends, established May 2026"). Raw conversation deleted; preference is the durable artifact.

### 6.3 Pruning Engine

A scheduled weekly/biweekly job:
1. Scan hot storage for items older than retention window.
2. Check data type, apply appropriate summarization strategy.
3. Run LLM summarization, write compressed version to warm storage, update embeddings.
4. Verify structured extractions exist in knowledge graph.
5. Move originals to "pending deletion" state (1-week grace period for recovery).
6. Purge after grace period.

A separate monthly job handles warm â†’ cold transitions and periodic summary aggregation.

**Token economics of pruning:** Summarizing one email costs ~1,000-2,000 tokens. At 50 meaningful emails/week, that's ~100K tokens/week â€” a few cents. Transcript summarization is more expensive but infrequent. Total pruning pipeline cost: ~$1-3/month in API calls.

---

## 7. Hosting & Infrastructure

### 7.1 Server Setup

**Single VPS, Docker Compose.** Everything runs on one machine.

Recommended: Hetzner CX32 or DigitalOcean droplet â€” 4 vCPUs, 8GB RAM, 80-160GB SSD. $15-30/month. More than sufficient for a single-user workload.

Docker Compose defines three services:
- **Postgres** (with pgvector extension): Structured data + vector embeddings.
- **Neo4j** (Community Edition): Knowledge graph.
- **Application server** (Python or Node): Orchestration logic, LLM API calls, ingestion pipeline, pruning jobs.

```
project/
â”œâ”€â”€ docker-compose.yml
â”œâ”€â”€ app/                  # Orchestration server
â”œâ”€â”€ backups/              # Backup scripts
â”œâ”€â”€ data/
â”‚   â”œâ”€â”€ postgres/         # Postgres data volume
â”‚   â””â”€â”€ neo4j/            # Neo4j data volume
â””â”€â”€ .env                  # API keys, DB credentials (injected at deploy time)
```

The LLM reasoning layer is not hosted â€” it's API calls to Claude or OpenAI. No GPU needed. The server is an orchestrator: receives trigger, gathers context from databases, assembles prompt, sends to LLM API, processes response.

### 7.2 Storage Sizing

| Data Type | Estimated Year 1 Size |
|---|---|
| Contacts & relationship metadata (500 people) | 5-10 MB |
| Calendar events | Negligible |
| Financial transactions (if cached) | ~50 MB |
| Conversation logs, emails, notes (raw text) | 500 MB - 1 GB |
| Vector embeddings (100K chunks Ã— ~6KB each) | ~600 MB |
| Neo4j knowledge graph | < 1 GB |
| **Total active system** | **~2-5 GB** |
| Archive in object storage | 2-5 GB/year |

This is a smart data system, not a big data system.

### 7.3 Backup & Recoverability

#### Infrastructure failure protection:
- Automated daily backups: `pg_dump` of Postgres + Neo4j database dump â†’ compressed â†’ encrypted with GPG key stored off-server â†’ shipped to object storage (different provider than hosting).
- VPS provider volume snapshots enabled as belt-and-suspenders.
- Recovery: spin up new VPS, pull docker-compose repo, restore from latest backup. Max data loss: 24 hours (or less with more frequent dumps).

#### Agent knowledge corruption protection:
Three tiers of protection:

1. **Audit log:** Every agent action that modifies state is logged with full context â€” what it read, what it concluded, what it changed.
2. **Weekly knowledge snapshots:** Full state of knowledge graph and key Postgres tables, labeled restore points ("the system as it was on Sunday night").
3. **Confidence & review system:** High-impact changes (merging contacts, changing relationship categorizations, updating financial rules) go to a "pending changes" queue for human review in the daily briefing. Low-stakes updates (logging an email, noting a calendar event) write directly.

#### Architectural safeguard:
- Every write the agent makes is an append, never a destructive update.
- Changelog table in Postgres: old value, new value, timestamp, reason, triggering LLM call.
- Graphiti's temporal model tracks validity windows on facts â€” old facts are invalidated, never deleted. Surgical rollback of specific facts without touching anything else.
- Nuclear option: nuke the entire knowledge graph and rebuild from the archive.

### 7.4 Monthly Operating Costs

| Item | Estimated Cost |
|---|---|
| VPS (4 vCPU, 8GB RAM) | $15-30 |
| Object storage (archive + backups) | < $1 |
| LLM API (Claude/OpenAI, ~10-20 queries/day + briefings + triage) | $10-30 |
| Embedding API (ingestion + archive indexing) | $2-5 |
| **Total** | **~$30-60/month** |

---

## 8. Security Architecture

### 8.1 Threat Model

If the server is compromised, an attacker gains: full relationship graph, financial picture, calendar/location patterns, communication history and style (enough to impersonate you), credentials for every integrated service, and the knowledge graph's inferences about you. This is a dossier, not a simple breach. The system must be treated with the seriousness of medical records or financial credentials.

### 8.2 Core Security Principles

#### Principle 1: Minimize what's stored
For every piece of information, ask: does the system need to *store* this, or just *access* it at query time? Financial data should be pulled from bank APIs at query time, not persisted as raw transaction history. Email content should be stored as metadata and summaries, not full bodies. The knowledge graph stores facts and relationships, not raw source material.

#### Principle 2: Encrypt data at rest with off-server keys
Database volumes encrypted with LUKS. Decryption key stored in a separate secrets manager (AWS Secrets Manager, HashiCorp Vault, or fetched from a separate service at boot time). Backups encrypted before leaving the server using a GPG key on your local machine. Even if an attacker compromises both the server and the backup storage, they can't read backups without your local key.

#### Principle 3: Segment credentials and blast radius
- Use short-lived OAuth tokens (not permanent API keys) wherever possible.
- Principle of least privilege: calendar = read-only, email = read-only, no send-as capability.
- Separate credentials from the application â€” use a secrets manager or inject via CI/CD at deploy time. File system compromise alone should not yield keys.

#### Principle 4: Authenticate everything
API server requires authentication on every endpoint, even though it's single-user. Strong API key or JWT over HTTPS. Entire server behind a WireGuard VPN â€” nothing exposed to the public internet except the VPN endpoint. The Neo4j browser, Postgres port, and application API are all VPN-only.

#### Principle 5: Treat the LLM API as a data exfiltration channel
Rich personal context is sent to Anthropic/OpenAI with every query. Mitigations:
- Enable zero data retention on LLM APIs.
- Consider local models for the most sensitive domains (financial analysis, health, intimate relationship context).
- Guard against prompt injection: external data (emails, documents) entering LLM prompts is treated as untrusted input, sandboxed in prompt structure, clearly delimited. System prompt instructs the model to treat ingested content as data, not instructions.

#### Principle 6: Audit logging and anomaly detection
Every database query, API call, and LLM interaction logged with timestamps. Logs shipped to an external service (separate from the main server) so an attacker can't delete them. Anomaly alerts: API calls at unusual hours, spikes in database queries, access from non-VPN IPs.

#### Principle 7: Design for breach containment
- Most sensitive data (financial, health, intimate relationships) in a separate encrypted partition requiring a second factor to unlock.
- Automatic credential rotation â€” short-lived OAuth tokens expire automatically if the server goes offline.
- Documented "breach runbook": a checklist executable from your phone that revokes every credential and kills the server.

### 8.3 The 2FA Interception Attack

**Critical threat:** If the assistant has email read access, and your accounts use email-based 2FA, an attacker who compromises the server can intercept password reset codes and 2FA codes through the assistant's email integration â€” effectively using your own assistant as a skeleton key for every account.

**Mitigations:**

1. **Move all 2FA off channels the assistant can see.** Use hardware security keys (YubiKey) or TOTP authenticator apps for everything important. Your second factor must travel through a channel the assistant has zero access to.

2. **Email integration should be blind to auth codes.** Filter at the ingestion level: emails from `noreply@` addresses containing "verification code," "reset your password," "one-time code," etc. are classified as security-sensitive and excluded from processing entirely. Never stored, never summarized, never embedded.

3. **Scope email tokens narrowly.** Use Gmail label/category filtering. Route all security-related emails to a separate address the assistant never touches via Gmail filters.

4. **Eliminate real-time email interception.** Poll on a delay (every 15-30 minutes) rather than real-time push. Or design email triage as a batch job you trigger manually, with the token expiring after processing.

5. **Use separate email addresses.** Your assistant monitors `you@yourdomain.com`. Your bank, brokerage, infrastructure passwords, and primary Google/Apple account use a completely separate `secure@yourdomain.com` that the assistant has no credentials for. The attacker can own your assistant's email token completely and still can't receive password reset emails for your bank.

6. **Monitor OAuth token usage.** Google Workspace and Microsoft 365 support audit logging independent of your server. Flag anomalous token usage: reads outside normal polling schedule, keyword searches the assistant would never make.

---

## 9. Realistic Data Inputs & Work Data Boundaries

### 9.1 The Work Data Rule

**The assistant does not touch work data. Full stop.**

Company data on company systems is subject to employment agreements, acceptable use policies, and potentially industry regulations. Pointing a personal AI assistant at work Gmail, Slack, or Zoom recordings is unauthorized exfiltration of company data â€” regardless of how well-secured the personal server is. If a breach occurs and company data is found on your personal VPS, it is a career-ending discovery.

**The distinction:** The assistant can be aware of work's *impact on your life* without ingesting work's *content*.

- **Bad:** "Your VP sent an email about restructuring. Here's a summary of the options."
- **Fine:** "You have 6 meetings tomorrow between 9 and 4 with no lunch break. Your 2pm is a one-on-one with your manager â€” you wanted to discuss the raise."

### 9.2 Input Channel Map

| Source | Integration Type | What's Captured | What's Excluded |
|---|---|---|---|
| **Personal Gmail** (custom domain) | Fully automated (OAuth, read-only) | Full pipeline: archive, triage, summarize, embed, knowledge graph | Security-sensitive emails filtered out |
| **Work Gmail** | NOT integrated | Nothing automated | Everything. Manually forward personal-relevant items to personal email when appropriate. |
| **Personal Google Calendar** | Fully automated (read-only) | Events feed scheduling engine | â€” |
| **Work Google Calendar** | Semi-automated (read-only share) | Free/busy or basic event details (times, titles) for unified schedule view. Shared to personal Google account, not accessed via work credentials. | Meeting content, attachments, notes |
| **Personal Google Drive** | Fully automated (read-only OAuth) | Documents archived and ingested | â€” |
| **Work Google Drive / file systems** | NOT integrated | Nothing | Everything |
| **Work Slack** | NOT integrated | Nothing | Everything |
| **iMessage** | Manual capture | Screenshots or copy-paste of specific conversations via quick-capture channel | No automated ingestion (no clean API; Apple actively prevents it) |
| **WhatsApp** | Periodic manual export | Chat history text files for important conversations, batch-ingested | No real-time integration |
| **Signal** | Not integrated | Nothing (by design â€” Signal conversations are meant to be ephemeral) | Everything |
| **Telegram** | Potentially automated (has full API) | Messages from personal conversations | â€” |
| **Discord** | Potentially automated (gray area) | Read-only personal server messages | â€” |
| **Physical mail** | Photo capture â†’ OCR | Photos sent to quick-capture bot. OCR extracts text, classifies (bill, legal doc, personal letter), extracts structured data. | â€” |
| **Meeting takeaways** | Voice memo capture | 60-second post-meeting voice note, transcribed via Whisper API | No recording of actual meetings. Your observations and takeaways only. |
| **Zoom/Slack/Google Meet recordings** | NOT integrated (work data) | Nothing | Everything |
| **Even Realities G2 Conversate transcripts** | Automated for personal conversations | Transcriptions and AI summaries from the companion app | Not used during work meetings |

### 9.3 Quick-Capture Channels

For data sources that can't or shouldn't be automated, three frictionless input methods:

1. **Telegram bot** (or simple mobile-friendly web form behind VPN): Pull out phone, type or dictate a note. "Met with James from client team, he mentioned contract renews in September." The assistant ingests this as a first-person note, extracts entities and facts.

2. **Photo capture:** Take a photo of physical mail, send to bot. System OCRs it, classifies it, extracts structured data, archives the original photo.

3. **Voice memos:** After a meeting or conversation, record a brief voice note. System transcribes (Whisper API), processes content. Supports annotations: "Dave mentioned he's leaving â€” told me in confidence, don't surface this."

**The key principle for work data:** You are the filter. You capture your own observations, feelings, plans, and takeaways â€” those are yours. The company's documents, messages, and recordings are theirs.

### 9.4 Sensitivity Tagging

Every stored item gets a sensitivity classification:

- **Personal:** Purely your own life. Assistant reasons freely.
- **Work-adjacent:** Your observations about work situations, career plans, colleague relationship notes. Assistant reasons about it but is conservative in surfacing â€” shouldn't generate output that reads like a company document.
- **Confidential:** Things told to you in confidence, sensitive information. System stores for your reference but never proactively surfaces. Requires explicit queries to retrieve.

---

## 10. Output Channels & The Even Realities G2

### 10.1 Even Realities G2 Smart Glasses

The G2 smart glasses are a high-priority output device for the assistant â€” not a novelty but a fundamentally better channel for ~80% of proactive notifications.

**Key specs:**
- No camera, no speakers â€” privacy-first design. Just a green micro-LED HUD display.
- 36g weight, looks like regular glasses. Available with prescription lenses (-12.00 to +12.00).
- 2-day battery life. Charging case provides 7 additional charges (~2 weeks without plugging in).
- $599 for glasses. R1 companion ring ($249) provides tap/slide/press input.
- Bluetooth 5.2 connection to phone. All processing happens on the companion app/phone.

**Developer ecosystem:**
- Even Hub: open developer platform with SDK and APIs (launched April 2026).
- React-based app templates (minimal, ASR, image, text-heavy).
- 55+ web components in official design system.
- Speech-to-text module built in.
- Community BLE protocol reverse-engineering project for direct Python control.
- Official developer docs for plugins, dashboard widgets, and AI integrations.

**Privacy:** No data stored in cloud without explicit consent. Processing is encrypted with PII removed.

### 10.2 Multi-Channel Output Architecture

The communication interface layer classifies every outbound notification by:

- **Urgency:** Immediate, next-available-glance, can-wait.
- **Length:** One-liner, short paragraph, full document.
- **Context-sensitivity:** Location-aware, meeting-aware, activity-aware.

| Channel | Best For | Examples |
|---|---|---|
| **G2 glasses** | Short, timely, contextual nudges | Relationship reminders, calendar awareness, financial alerts, navigation, meeting prep one-liners |
| **Phone (Telegram bot / app)** | Richer interactions, drafts for review, summaries requiring action | Email triage summaries, drafted replies, comparison research, multi-paragraph briefings |
| **Desktop** | Full working sessions, document review, deep research | Complete morning briefings, financial analysis, document management, system administration |

**Key UX insight:** A phone buzz is an interruption. A line of green text in your peripheral vision is an *option*. The glasses allow the assistant to push information proactively without being intrusive â€” the user chooses when to glance at it.

### 10.3 G2 Integration Path

Build an Even Hub app that serves as a thin client for the assistant:
1. Assistant server decides something is worth surfacing.
2. Pushes notification to companion app on phone (over VPN).
3. App formats content for G2's green monochrome HUD.
4. Glasses display it in peripheral vision.

R1 ring enables quick input: tap to trigger voice capture that goes directly to the assistant's ingestion pipeline, replacing the need to pull out your phone for the Telegram bot in many cases.

Conversate transcription feature can pipe meeting summaries into the ingestion pipeline for personal (non-work) conversations â€” solving the meeting-takeaway capture problem passively.

---

## 11. Competitive Landscape

### 11.1 Assessment (as of May 2026)

**Nobody has built the unified system described in this plan.** The market is fragmented into specialized tools that each do one or two pieces:

- **Calendar/scheduling** (Motion, Morgen, Reclaim): Mature, genuinely useful, but only calendar. No relationship, finance, or household awareness.
- **Personal CRM** (Monica, Clay, Folk): Passive contact databases with reminders. Don't reason about relationships or suggest proactive outreach based on context.
- **AI assistants** (Lindy, Zapier Agents, Arahi): Automation platforms where you build workflows. Not an intelligent assistant that understands your whole life.
- **Proactive AI** (Poppy â€” launched May 2026): Closest to this vision. Works across calendar, email, health, contacts, messaging. But brand new, doesn't touch finances or household management.
- **Household** (Ohai): Family-focused calendar coordination. Narrow scope.

### 11.2 Strategic Position

A personal system built by you, for you, has structural advantages:
- Opinionated and specific â€” doesn't need to support every provider, just yours.
- No onboarding, user management, or multi-tenancy â€” eliminates 70% of commercial product engineering.
- The unified knowledge layer connecting all domains is the actual differentiator, and no existing product has it.
- Even if it never becomes a product, the skills learned (RAG, vector databases, knowledge graphs, LLM orchestration, agentic patterns) are the most in-demand skillset in software right now.

---

## 12. Learning Path & Technology Stack

### 12.1 Core Technologies

| Technology | Purpose | Familiarity |
|---|---|---|
| **PostgreSQL** | Structured data, relational storage | Known (full-stack web dev background) |
| **pgvector** | Vector embeddings, semantic search | New â€” learn |
| **Neo4j** | Graph database for knowledge graph | New â€” learn |
| **Graphiti** (by Zep AI) | Temporal knowledge graph engine on Neo4j | New â€” learn |
| **Claude API / Anthropic SDK** | LLM reasoning, summarization, extraction | New â€” learn |
| **OpenAI Embeddings API** | Text â†’ vector embeddings | New â€” learn |
| **Docker Compose** | Container orchestration | Likely known |
| **WireGuard** | VPN for server access | New â€” learn |
| **S3 / Backblaze B2** | Object storage for archive | Likely known |

### 12.2 Structured Learning Path (Week 1-2)

#### Phase 1: Understand embeddings conceptually (Day 1-2)
- Search: `"what are vector embeddings explained for developers"`
- Search: `"embeddings RAG explained simply"`
- Key resource: DEV.to guide on embeddings and pgvector (explains with concrete examples of phrase similarity)

#### Phase 2: Postgres + pgvector hands-on (Day 2-4)
- Search: `"pgvector docker tutorial postgres vector database"`
- Start with pgvector GitHub README â€” covers installation, vector columns, distance operators.
- Search: `"pgvector RAG tutorial OpenAI embeddings postgres"`
- Key resource: Tiger Data's three-part tutorial (create embeddings â†’ store with pgvector â†’ augment LLM generation). Has Jupyter notebook.
- Docker setup: `pgvector/pgvector:pg16` image.

#### Phase 3: Neo4j basics (Day 4-6)
- Search: `"neo4j getting started tutorial cypher query language"`
- Neo4j Browser at localhost:7474 has built-in interactive Cypher tutorials.
- Search: `"neo4j docker compose setup tutorial"`
- Search: `"cypher query language tutorial beginners"`
- Cypher reads like English: `MATCH (p:Person)-[:KNOWS]->(friend) WHERE p.name = "Sarah" RETURN friend`

#### Phase 4: Graphiti (Day 6-8)
- Search: `"graphiti-core quickstart tutorial neo4j"`
- Official Quickstart at help.getzep.com â€” connecting to Neo4j, building indices, adding episodes, searching.
- Search: `"graphiti zep knowledge graph agent memory tutorial"`
- Key resource: Saeed Hajebi's Medium guide (comprehensive conceptual + practical walkthrough)
- GitHub repo `examples/quickstart` directory for hands-on code.

#### Phase 5: Claude API + RAG pipeline (Day 8-10)
- Search: `"build RAG Claude API pgvector tutorial"`
- Key resource: Tiger Data's RAG + Claude + PostgreSQL walkthrough.
- Search: `"Anthropic Claude API tool use tutorial"`
- Key resource: Anthropic's official course at anthropic.com/learn/build-with-claude and anthropic.skilljar.com. Covers API setup, RAG, and tool use.
- Search: `"Claude API tool use function calling"`
- Core pattern: user question â†’ Claude picks tools â†’ your code executes â†’ return tool_result â†’ Claude writes final response. This is the fundamental loop of the entire assistant.

#### Phase 6: Docker Compose integration (Day 10-14)
- Search: `"docker compose postgres neo4j python app multi-service"`
- Search: `"pg_dump automated backup script docker cron"`
- Get Postgres + Neo4j + app server running locally. Write one endpoint that accepts a question, queries both databases, assembles a prompt, calls Claude API, returns a response. Get backup scripts working.

---

## 13. Implementation Timeline

### Month 1: Foundation
- [ ] Docker Compose stack running locally (Postgres + pgvector, Neo4j, app server).
- [ ] Structured data models: contacts, events, cadences, preferences.
- [ ] Personal Gmail integration (OAuth, read-only) with email classification pipeline.
- [ ] Archive pipeline: every email archived to object storage before processing.
- [ ] Basic embedding pipeline: emails chunked, embedded, stored in pgvector.
- [ ] Personal Google Calendar sync.
- [ ] Quick-capture Telegram bot (text + photo input).
- [ ] Photo OCR pipeline for physical mail.
- [ ] Basic daily briefing: "Here's what's on your calendar, here are important emails, here are reminders."
- [ ] Backup scripts: pg_dump + Neo4j dump â†’ encrypted â†’ object storage.
- [ ] WireGuard VPN setup.
- [ ] Deploy to VPS.

### Month 2: Knowledge & Memory
- [ ] Graphiti integration: Neo4j knowledge graph populated from email and note ingestion.
- [ ] Relationship model: contacts enriched with extracted facts, interaction history, relationship metadata.
- [ ] RAG retrieval pipeline: queries search both pgvector and knowledge graph, assemble context for LLM.
- [ ] Voice memo ingestion: Whisper API transcription â†’ processing pipeline.
- [ ] Conversation memory: assistant remembers past interactions, builds preference profile.
- [ ] Event & cadence engine: recurring reminders, deadline sequences, basic conditional triggers.
- [ ] Archive embedding index: comprehensive secondary index over all originals.
- [ ] Pruning job v1: hot â†’ warm tier summarization for emails.
- [ ] Google Drive integration: personal documents ingested and archived.

### Month 3: Intelligence & Output
- [ ] Reasoning layer: proactive pattern recognition, conflict detection, priority triage.
- [ ] Financial integration: at minimum CSV transaction import, ideally Plaid API for balance checking.
- [ ] Multi-channel output: priority/length/context classification for notifications.
- [ ] Even Realities G2 integration: Even Hub app as thin client for assistant notifications.
- [ ] R1 ring quick-capture: tap to trigger voice input directly to assistant.
- [ ] Meeting prep assembly: pulling context from knowledge graph + recent interactions before scheduled meetings.
- [ ] Pruning job v2: warm â†’ cold transitions, periodic summary aggregation, transcript summarization.
- [ ] Sensitivity tagging system: personal / work-adjacent / confidential classification.
- [ ] Audit log review interface: see what the agent has been doing and why.
- [ ] Breach runbook: documented, tested, executable from phone.

### Ongoing
- [ ] Preference refinement: system gets better at prioritization, tone, timing.
- [ ] Additional integrations as trust builds: expand from Tier 1 toward selective Tier 2 capabilities.
- [ ] Household management module: maintenance schedules, registration reminders.
- [ ] Goal tracking module: long-arc progress monitoring.
- [ ] Periodic reprocessing: as better models/tools emerge, rebuild derived layers from archive.

---

## 14. Key Design Decisions & Principles

1. **Build primitives, not features.** Features are configurations of the six core architectural blocks.
2. **The knowledge system is a cache; the archive is the truth.** Everything derived can be rebuilt from originals.
3. **Every write is an append.** No destructive updates. Full audit trail. Temporal validity on all facts.
4. **Trust is earned incrementally.** Start at Tier 1 (observe and inform). Expand only as confidence builds.
5. **Work data stays in work systems.** The assistant knows about work's impact on your life, not work's content.
6. **You are the filter for unstructured input.** Manual capture through frictionless channels, informed by your judgment about what's personal vs. proprietary.
7. **Security is not an afterthought.** Assume eventual compromise. Minimize stored data, encrypt everything, segment credentials, plan for containment.
8. **The glasses change the UX equation.** Proactive surfacing becomes non-intrusive when it's a peripheral glance, not a phone buzz.
9. **Context engineering matters more than model choice.** Getting the right 3,000 tokens into the prompt beats throwing 100K tokens at a bigger context window.
10. **The system should get smarter, not just bigger.** Progressive summarization, preference extraction, and pattern recognition mean the assistant improves even as raw data is compressed away.

---

*This document should be treated as a living plan. Update it as architectural decisions are made, technologies are evaluated, and implementation reveals new constraints or opportunities.*
