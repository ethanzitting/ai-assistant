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
| **Meeting takeaways** | Voice memo capture | 60-second post-meeting voice note, transcribed via Deepgram API | Your observations and takeaways |
| **Audio/video files** | Deepgram transcription | Full audio or video files (MP4, WebM, WAV, MP3, OGG) transcribed via Deepgram API (Nova-2). Version 1: handled directly in the agent container via Telegram voice, audio, video, and video note messages. Transcript flows through the event loop as a regular user message. Version 2: moves to the ingestion container with full isolation and adds speaker diarization. | Raw media files and companion transcripts archived to B2 |
| **Conversations with the assistant** | Always on | Every message you send is scanned for entities, facts, tasks, intentions, and preferences — extracted to knowledge graph in real time | Routine queries pruned after 1 month; see [data-lifecycle.md](data-lifecycle.md) |

## Quick-capture channels

For data sources that can't or shouldn't be automated, three frictionless input methods:

1. **Telegram bot** (or simple mobile-friendly web form behind VPN). Pull out phone, type or dictate a note or task. *"Met with James from client team, he mentioned contract renews in September."* The assistant ingests this as a first-person note, extracts entities and facts. Also the primary interface for creating and managing tasks: *"Add a task: research lumber options for the dog house project."*
2. **Document and photo capture.** Send documents (PDFs, images, text files) to the Telegram bot or email them to a designated address. Photos of physical mail are OCR'd, classified, and structured data extracted. Email attachments are automatically extracted and processed. All files are stored in the file store and cataloged in the knowledge graph. See [data-architecture.md](data-architecture.md).
3. **Voice memos.** After a meeting or conversation, record a brief voice note. System transcribes (Deepgram API), processes content. Supports annotations: *"Dave mentioned he's leaving — told me in confidence, don't surface this."*

The Telegram bot is also the primary inbound interface during the prototype phase — see [interfaces.md](interfaces.md).

## Web search and fetching (research flows)

All web interaction — Anthropic web search and direct URL fetching — runs through the ingestion container, never the agent. Web search results and fetched pages are untrusted external content, just like emails and documents, so they belong behind the same isolation boundary: processed by the ingestion LLM, emitted as structured records through the schema-validated emission channel, validated by the agent before acting on them.

This prevents a critical attack vector: if web search ran directly in the agent, a prompt injection in a search result could influence an LLM call with full system privileges (database writes, knowledge graph updates, preference changes). Routing through ingestion means a successful injection can only produce schema-valid emissions — the same constrained blast radius as a compromised email.

**Two constraints on web fetching:**

1. **Only triggered by explicit user requests routed through the agent.** The ingestion container never autonomously follows URLs found in emails, documents, or other ingested content. The agent decides "user wants this researched" and instructs ingestion to search or fetch. This breaks the email → URL → injection chain. See [security.md](security.md).
2. **The agent never enables web search on its own LLM calls.** The agent's Anthropic API calls are for reasoning over trusted, already-validated context (knowledge graph data, validated emissions, user messages). Untrusted web content never enters a privileged LLM call.

### Research archive policy

Not all web content is worth keeping. The archive policy distinguishes between research artifacts (high-value, keep) and transient web content (extract and discard):

**Always archive:**
- **Research documents** — the agent produces a structured summary for each research task: findings, source citations, confidence notes, date of research. These are the agent's "notes" and are small, high-value, and permanently archived to B2. They get embedded in `document_chunks` for semantic search and their findings are stored as knowledge graph facts with `source_ref` pointing back to the research document.
- **Substantive source materials** — PDFs of studies, papers, authoritative reference pages that the agent cited in its findings. Archived alongside the research document when the agent judges the source is worth keeping for future reference.

**Never archive:**
- Intermediate search result pages, SEO content, navigation pages, generic blog posts. The agent extracts what's useful and discards the raw HTML.
- Web pages scanned for a single data point (e.g., checking a tax deadline date). The extracted fact goes into the knowledge graph; the page doesn't go into the archive.

The agent's judgment decides the boundary — the system prompt instructs it to archive source material when it's substantive enough that the user might want to revisit it, and to skip everything else. The research document itself is always the primary artifact; source materials are supplementary.

Research findings stored in the knowledge graph should be treated as perishable when they depend on external state (tax laws, regulations, pricing). The system prompt instructs the LLM to re-verify such findings rather than assuming last year's research still holds.

## Agent → ingestion coordination

The agent instructs ingestion to do work via the `processing_requests` table. When a file arrives via Telegram, the agent downloads it to a shared volume and inserts a processing request. When the user asks for web research, the agent inserts a search request. Ingestion polls this table for pending work.

```sql
CREATE TABLE processing_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL,              -- 'file_parse', 'receipt_ocr', 'web_search', 'email_sync'
    source_type TEXT NOT NULL,       -- 'telegram_file', 'drive_file', 'user_request'
    file_path TEXT,
    status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'processing', 'completed', 'failed'
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
```

Ingestion has SELECT + UPDATE on this table (to claim and complete requests) but cannot read the knowledge graph or any other table. This is the same coordination pattern used for web search — see [data-architecture.md](data-architecture.md) for the full coordination model.

## Receipt and document processing

Photos of receipts sent via Telegram flow through the same ingestion pipeline as other files. Ingestion runs OCR (Tesseract locally, or a cloud OCR API for difficult receipts), then the ingestion LLM extracts structured data (merchant, date, line items, total, payment method, category). Results are emitted as `transaction` emissions through the standard emission flow, with line items stored as JSONB. See [workflow-financial-tracking.md](development/workflow-financial-tracking.md) for the full receipt processing walkthrough.

## Architectural constraint

The ingestion pipeline runs as a **separate container** from the agent, with strict isolation. It processes all untrusted external content (emails, Telegram messages, web pages, documents, audio/video files) and can only emit structured records through a schema-validated channel. It cannot read the knowledge graph, modify preferences, trigger actions, or access secrets beyond its own API keys. This prevents prompt injection in ingested content from causing unintended side effects. Media transcription (Deepgram) happens inside this container — audio is extracted from video files via ffmpeg, sent to Deepgram, and the resulting transcript is treated as untrusted content subject to the same validation as any other emission. See [security.md](security.md) for the full isolation model.

## Sensitivity tagging

Every stored item gets a sensitivity classification:

- **Normal.** Default classification. Assistant reasons and surfaces freely.
- **Confidential.** Things told to you in confidence, sensitive information. System stores for your reference but never proactively surfaces. Requires explicit queries to retrieve.

Sensitivity tags are honored by the [reasoning layer](primitives.md) when deciding what to surface proactively and how conservatively to handle the data.
