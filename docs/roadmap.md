# Roadmap

Phased implementation plan. Month 1 is deliberately minimal — get it working and generating real feedback. Months 2+ are reprioritized based on what actually matters after using the system daily.

## Month 1 — Talking Chatbot

The goal is a conversational agent on Digital Ocean that knows your calendar, can set reminders, and holds context across a conversation. Barely useful, but running and generating real feedback.

- [ ] Docker Compose stack: dev environment with hot-reloading, production-ready on Digital Ocean. See [infrastructure.md](infrastructure.md) for the dev environment design
- [ ] Postgres + pgvector in Docker
- [ ] Knowledge graph schema: entities, relationships, facts tables with temporal validity
- [ ] Structured data models: contacts, events, cadences, preferences
- [ ] 1Password integration: all secrets retrieved via `op run`, no `.env` on disk
- [ ] Anthropic API integration with prompt caching
- [ ] Core event loop: agentic processing with coarse tools, event queue, priority levels. See [core-loop.md](core-loop.md)
- [ ] Basic conversation management: token-budget truncation to prevent context window blowup (full four-layer context assembly is Month 2)
- [ ] Personal Google Calendar sync (OAuth, read-only, polling)
- [ ] Telegram bot: text input, long polling, routed directly to core. See [core-loop.md](core-loop.md)
- [ ] Event engine: scheduling, reminders, daily briefing trigger, recurring events. See [event-engine.md](event-engine.md)
- [ ] Basic daily briefing: *"Here's what's on your calendar, here are your reminders and upcoming deadlines"*
- [ ] Skills table: name + description in stable prefix, body fetched on demand
- [ ] Backup scripts: pg_dump → encrypted → object storage
- [ ] Deploy to Digital Ocean, accessed via DO console SSH

**Not in scope for Month 1:** Email ingestion, web search, embeddings, WireGuard VPN, circuit breakers or kill switch, Telegram file/photo uploads, physical mail OCR, voice memos, sandbox container, container isolation, SSH CLI.

## Month 2 — Memory, Email & Safety

The goal is a system that remembers across conversations, processes your email, and has real security boundaries. Prioritized based on Month 1 feedback.

- [ ] Context assembly: four-layer prompt construction (stable prefix, daily prefix, recent prefix, conversation), token-budget compaction, nightly prefix rebuild. See [context-assembly.md](context-assembly.md)
- [ ] Conversation memory: assistant remembers past interactions, extracts entities and facts in real time, builds preference profile
- [ ] Container isolation: separate ingestion container (emission-only DB access), core container (full DB access), schema-validated emission channel
- [ ] Personal Gmail integration (OAuth, read-only) with email classification pipeline — runs in ingestion container
- [ ] Archive pipeline: every email archived to object storage before processing
- [ ] Basic embedding pipeline: emails chunked, embedded, stored in pgvector
- [ ] Anthropic web search as the agent's research tool (runs in ingestion, not core — core never processes untrusted external content directly)
- [ ] Knowledge graph population: entities and facts extracted from email and calendar ingestion
- [ ] Prompt injection defense: structural prompt sandboxing, self-hosted injection classifier (risk scoring, not gating — see [security.md](security.md)), emission validation in core
- [ ] Task & project engine: task CRUD via Telegram, status tracking, surfacing policy, project grouping
- [ ] Agent safety controls: circuit breakers (budget caps, loop detection, scope enforcement) + kill switch
- [ ] WireGuard VPN: no public-facing endpoints except VPN
- [ ] SSH CLI: admin commands, kill switch, status, query, task management. See [interfaces.md](interfaces.md)
- [ ] Telegram file uploads: documents and photos sent to bot, routed to ingestion for processing
- [ ] Voice memo ingestion: Whisper API transcription → processing pipeline
- [ ] Pruning job v1: hot → warm tier summarization for emails

## Month 3 — Smarter & More Useful

The goal is a system that gets noticeably better at surfacing the right information at the right time.

- [ ] Sandbox container: Deno runtime, LLM-generated code execution against read-only data slices, PDF parsing
- [ ] Entity enrichment: contacts, projects enriched with extracted facts across all sources
- [ ] RAG retrieval pipeline: queries search pgvector + knowledge graph tables, assemble context for LLM
- [ ] Proactive pattern recognition: detect repeated behaviors, stalled intentions, scheduling conflicts
- [ ] Financial awareness: at minimum CSV transaction import, ideally Plaid API for balance checking (read-only)
- [ ] Ad-hoc data analysis: natural language queries that generate and execute code in the sandbox (e.g., *"show me spending outliers"*)
- [ ] Mid-day event surfacing: proactive notifications and silent context injection for events arriving between daily prefix rebuilds
- [ ] Meeting prep surfacing: pulling context from knowledge graph + recent interactions before scheduled meetings
- [ ] File store integration: Google Drive as ingestion source, Backblaze B2 as archive, file cataloging in knowledge graph
- [ ] Photo OCR pipeline for physical mail
- [ ] Multi-channel output: priority/length/context classification for notifications
- [ ] Sensitivity tagging system: normal / confidential classification
- [ ] Pruning job v2: warm → cold transitions, periodic summary aggregation

## Ongoing — Refinement

- [ ] Preference refinement: system gets better at prioritization, tone, timing
- [ ] Household management module: maintenance schedules, registration reminders
- [ ] Goal tracking: long-arc progress monitoring, stalled-intention detection (builds on task & project engine)
- [ ] Smartwatch notifications: Apple Watch as glanceable output channel
- [ ] Research & fact-checking: steelman/flaw analysis, living fact-check cache in knowledge graph (builds on Anthropic web search from Month 1)
- [ ] Audit log review interface: see what the agent has been doing and why
- [ ] Breach runbook: documented, tested, executable from phone
- [ ] Additional ingestion sources as needs arise
- [ ] Periodic reprocessing: as better models/tools emerge, rebuild derived layers from archive

## Future — Draft & Act Capabilities

These capabilities require the assistant to act on your behalf. They get built when the core system is running reliably and generating real daily value.

- [ ] Email drafting: compose replies in your voice for review before sending
- [ ] Expand integrations from read-only to draft/propose permissions
- [ ] Agent-delegated subtasks: agent autonomously picks up research and other tasks from the project engine
- [ ] Data droplet separation: move Postgres and file archive access behind a rate-limited API on a separate droplet. Kill switch severs the connection from the data side — works even in full agent compromise. Agent becomes a client of the data store, not a direct database user
