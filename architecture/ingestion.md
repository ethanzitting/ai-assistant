# Ingestion

What data comes into the assistant, what doesn't, and how it gets in. Implements the "senses" primitive from [primitives.md](primitives.md). Per-source processing pipelines (what happens *after* ingestion) live in [data-lifecycle.md](data-lifecycle.md).

## Data trust principle

**Any data provided to the assistant is assumed to have permission to be processed.** The user decides what to share — the agent works with whatever it receives without policing boundaries. If you forward a work email, share a document, or dictate a meeting takeaway, the agent treats it as fair game for extraction, storage, and retrieval.

## Input channel map

| Source | Integration type | What's captured | What's excluded |
|---|---|---|---|
| **Gmail** (custom domain) | Fully automated (OAuth, read-only) | Full pipeline: archive, triage, summarize, embed, knowledge graph | Security-sensitive emails filtered out — see [security.md](security.md) |
| **Google Calendar** | Fully automated (read-only) | Events feed scheduling engine | — |
| **Google Drive** | Polling (read-only OAuth, every 5 min) | Documents ingested and archived to B2. Primary path for uploading files to the agent. Uses Drive API `changes.list` endpoint — single API call per poll to detect new or modified files | — |
| **iMessage** | Manual capture | Screenshots or copy-paste of specific conversations via quick-capture channel | No automated ingestion (no clean API; Apple actively prevents it) |
| **WhatsApp** | Periodic manual export | Chat history text files for important conversations, batch-ingested | No real-time integration |
| **Signal** | Not integrated | Nothing (by design — Signal conversations are meant to be ephemeral) | Everything |
| **Telegram** | Potentially automated (has full API) | Messages from personal conversations | — |
| **Discord** | Potentially automated (gray area) | Read-only personal server messages | — |
| **Physical mail** | Photo capture → OCR | Photos sent to quick-capture bot. OCR extracts text, classifies (bill, legal doc, personal letter), extracts structured data | — |
| **Meeting takeaways** | Voice memo capture | 60-second post-meeting voice note, transcribed via Whisper API | Your observations and takeaways |
| **Conversations with the assistant** | Always on | Every message you send is scanned for entities, facts, tasks, intentions, and preferences — extracted to knowledge graph in real time | Routine queries pruned after 1 month; see [data-lifecycle.md](data-lifecycle.md) |

## Quick-capture channels

For data sources that can't or shouldn't be automated, three frictionless input methods:

1. **Telegram bot** (or simple mobile-friendly web form behind VPN). Pull out phone, type or dictate a note or task. *"Met with James from client team, he mentioned contract renews in September."* The assistant ingests this as a first-person note, extracts entities and facts. Also the primary interface for creating and managing tasks: *"Add a task: research lumber options for the dog house project."*
2. **Document and photo capture.** Send documents (PDFs, images, text files) to the Telegram bot or email them to a designated address. Photos of physical mail are OCR'd, classified, and structured data extracted. Email attachments are automatically extracted and processed. All files are stored in the file store and cataloged in the knowledge graph. See [data-architecture.md](data-architecture.md).
3. **Voice memos.** After a meeting or conversation, record a brief voice note. System transcribes (Whisper API), processes content. Supports annotations: *"Dave mentioned he's leaving — told me in confidence, don't surface this."*

The Telegram bot is also the primary inbound interface during the prototype phase — see [interfaces.md](interfaces.md).

## Web search and fetching (research flows)

All web interaction — Anthropic web search and direct URL fetching — runs through the ingestion container, never core. Web search results and fetched pages are untrusted external content, just like emails and documents, so they belong behind the same isolation boundary: processed by the ingestion LLM, emitted as structured records through the schema-validated emission channel, validated by core before acting on them.

This prevents a critical attack vector: if web search ran directly in core, a prompt injection in a search result could influence an LLM call with full system privileges (database writes, knowledge graph updates, preference changes). Routing through ingestion means a successful injection can only produce schema-valid emissions — the same constrained blast radius as a compromised email.

**Two constraints on web fetching:**

1. **Only triggered by explicit user requests routed through core.** The ingestion container never autonomously follows URLs found in emails, documents, or other ingested content. Core decides "user wants this researched" and instructs ingestion to search or fetch. This breaks the email → URL → injection chain. See [RISKS.md](RISKS.md).
2. **Core never enables web search on its own LLM calls.** Core's Anthropic API calls are for reasoning over trusted, already-validated context (knowledge graph data, validated emissions, user messages). Untrusted web content never enters a privileged LLM call.

Fetched files are stored in the file store and cataloged in the knowledge graph.

## Architectural constraint

The ingestion pipeline runs as a **separate container** from the core system, with strict isolation. It processes all untrusted external content (emails, Telegram messages, web pages, documents) and can only emit structured records through a schema-validated channel. It cannot read the knowledge graph, modify preferences, trigger actions, or access secrets beyond its own API keys. This prevents prompt injection in ingested content from causing unintended side effects. See [security.md](security.md) for the full isolation model.

## Sensitivity tagging

Every stored item gets a sensitivity classification:

- **Normal.** Default classification. Assistant reasons and surfaces freely.
- **Confidential.** Things told to you in confidence, sensitive information. System stores for your reference but never proactively surfaces. Requires explicit queries to retrieve.

Sensitivity tags are honored by the [reasoning layer](primitives.md) when deciding what to surface proactively and how conservatively to handle the data.
