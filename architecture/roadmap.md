# Roadmap

Phased implementation plan. Month 1 is deliberately minimal — get it working and generating real feedback. Months 2+ are reprioritized based on what actually matters after using the system daily.

## Month 1 — Get It Useful

The goal is a running system on Digital Ocean that reads your email and calendar, chats via Telegram, searches the web, and produces a daily briefing. Useful enough to generate real feedback for prioritizing everything else.

- [ ] Docker Compose stack on Digital Ocean droplet (Postgres + pgvector, single application container — no container isolation yet)
- [ ] Knowledge graph schema: entities, relationships, facts tables with temporal validity
- [ ] Structured data models: contacts, events, cadences, preferences
- [ ] 1Password integration: all secrets retrieved via `op run`, no `.env` on disk
- [ ] Anthropic API integration with prompt caching
- [ ] Anthropic web search as the agent's research tool
- [ ] Personal Gmail integration (OAuth, read-only) with email classification pipeline
- [ ] Archive pipeline: every email archived to object storage before processing
- [ ] Basic embedding pipeline: emails chunked, embedded, stored in pgvector
- [ ] Personal Google Calendar sync
- [ ] Telegram bot (text input only — no file uploads, no photo capture)
- [ ] Basic daily briefing: *"Here's what's on your calendar, here are important emails, here are reminders"*
- [ ] Backup scripts: pg_dump → encrypted → object storage
- [ ] Deploy to Digital Ocean, accessed via DO console SSH

**Not in scope for Month 1:** WireGuard VPN, circuit breakers or kill switch, Telegram file/photo uploads, physical mail OCR, voice memos, sandbox container, task management, container isolation.

## Month 2 — Memory, Safety & Tasks

The goal is a system that remembers across conversations, tracks what you need to do, and has real security boundaries. Prioritized based on Month 1 feedback.

- [ ] Context assembly: four-layer prompt construction (stable prefix, daily prefix, recent prefix, conversation), token-budget compaction, nightly prefix rebuild. See [context-assembly.md](context-assembly.md)
- [ ] Conversation memory: assistant remembers past interactions, extracts entities and facts in real time, builds preference profile
- [ ] Knowledge graph population: entities and facts extracted from email and calendar ingestion
- [ ] Task & project engine: task CRUD via Telegram, status tracking, surfacing policy, project grouping
- [ ] Event & cadence engine: recurring reminders, deadline sequences, basic conditional triggers
- [ ] Container isolation: separate ingestion container (emission-only DB access), core container (full DB access), schema-validated emission channel
- [ ] Prompt injection defense: structural prompt sandboxing, classifier filter, emission validation in core
- [ ] Agent safety controls: circuit breakers (budget caps, loop detection, scope enforcement) + kill switch
- [ ] WireGuard VPN: no public-facing endpoints except VPN
- [ ] SSH CLI: admin commands, kill switch, status, query, task management. See [interfaces.md](interfaces.md)
- [ ] Telegram file uploads: documents and photos sent to bot, stored and cataloged
- [ ] Voice memo ingestion: Whisper API transcription → processing pipeline
- [ ] Pruning job v1: hot → warm tier summarization for emails

## Month 3 — Smarter & More Useful

The goal is a system that gets noticeably better at surfacing the right information at the right time.

- [ ] Sandbox container: gVisor runtime, LLM-generated code execution against read-only data slices, PDF parsing
- [ ] Entity enrichment: contacts, projects enriched with extracted facts across all sources
- [ ] RAG retrieval pipeline: queries search pgvector + knowledge graph tables, assemble context for LLM
- [ ] Proactive pattern recognition: detect repeated behaviors, stalled intentions, scheduling conflicts
- [ ] Financial awareness: at minimum CSV transaction import, ideally Plaid API for balance checking (read-only)
- [ ] Ad-hoc data analysis: natural language queries that generate and execute code in the sandbox (e.g., *"show me spending outliers"*)
- [ ] Mid-day event surfacing: proactive notifications and silent context injection for events arriving between daily prefix rebuilds
- [ ] Meeting prep surfacing: pulling context from knowledge graph + recent interactions before scheduled meetings
- [ ] File store integration: Google Drive or GCS as active file system, file cataloging in knowledge graph
- [ ] Photo OCR pipeline for physical mail
- [ ] Multi-channel output: priority/length/context classification for notifications
- [ ] Sensitivity tagging system: personal / work-adjacent / confidential classification
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
