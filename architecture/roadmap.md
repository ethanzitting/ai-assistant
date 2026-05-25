# Roadmap

Phased implementation plan. Each month builds on the previous one; each checkbox is a shippable unit of work.

## Month 1 — Foundation

The goal is a running system that ingests data, stores it, and produces a daily briefing.

- [ ] Docker Compose stack running locally (Postgres + pgvector, core, ingestion, sandbox containers)
- [ ] Knowledge graph schema: entities, relationships, facts tables with temporal validity
- [ ] Structured data models: contacts, events, cadences, preferences
- [ ] 1Password integration: all secrets retrieved via `op run`, no `.env` on disk
- [ ] Personal Gmail integration (OAuth, read-only) with email classification pipeline
- [ ] Archive pipeline: every email archived to object storage before processing
- [ ] Basic embedding pipeline: emails chunked, embedded, stored in pgvector
- [ ] Personal Google Calendar sync
- [ ] Quick-capture Telegram bot (text + photo input)
- [ ] Photo OCR pipeline for physical mail
- [ ] Basic daily briefing: *"Here's what's on your calendar, here are important emails, here are reminders, and here are tasks due for attention"*
- [ ] Agent safety controls: circuit breakers (budget caps, loop detection, scope enforcement) + kill switch
- [ ] Backup scripts: pg_dump → encrypted → object storage
- [ ] WireGuard VPN setup
- [ ] Deploy to VPS

## Month 2 — Knowledge & Memory

The goal is a system that remembers, connects dots, and retrieves context intelligently.

- [ ] Knowledge graph population: entities and facts extracted from email and note ingestion
- [ ] Entity enrichment: contacts, contracts, projects enriched with extracted facts from emails and notes
- [ ] RAG retrieval pipeline: queries search pgvector + knowledge graph tables, assemble context for LLM
- [ ] Container isolation: ingestion container with emission-only DB access, core container with full DB access, schema-validated emission channel
- [ ] Prompt injection defense: structural prompt sandboxing, classifier filter, emission validation in core
- [ ] Voice memo ingestion: Whisper API transcription → processing pipeline
- [ ] Conversation memory: assistant remembers past interactions, builds preference profile
- [ ] Context assembly: four-layer prompt construction (stable prefix, daily prefix, recent prefix, conversation), token-budget compaction, nightly prefix rebuild
- [ ] Event & cadence engine: recurring reminders, deadline sequences, basic conditional triggers
- [ ] Task & project engine: task CRUD via Telegram, status tracking, surfacing policy, project grouping
- [ ] Sandbox container: gVisor runtime, LLM-generated code execution against read-only data slices, PDF parsing
- [ ] File store integration: Google Drive or GCS as active file system, file cataloging in knowledge graph
- [ ] Archive embedding index: comprehensive secondary index over all files
- [ ] Pruning job v1: hot → warm tier summarization for emails

## Month 3 — Smarter & More Useful

The goal is a system that gets noticeably better at surfacing the right information at the right time.

- [ ] Proactive pattern recognition: detect repeated behaviors, stalled intentions, scheduling conflicts
- [ ] Financial awareness: at minimum CSV transaction import, ideally Plaid API for balance checking (read-only)
- [ ] Mid-day event surfacing: proactive notifications and silent context injection for events arriving between daily prefix rebuilds
- [ ] Multi-channel output: priority/length/context classification for notifications
- [ ] Smartwatch notifications: Apple Watch as glanceable output channel
- [ ] Research & fact-checking: web search via ingestion container, file capture, steelman/flaw analysis, living fact-check cache in knowledge graph
- [ ] Ad-hoc data analysis: natural language queries that generate and execute code in the sandbox (e.g., "show me spending outliers")
- [ ] Meeting prep surfacing: pulling context from knowledge graph + recent interactions before scheduled meetings
- [ ] Pruning job v2: warm → cold transitions, periodic summary aggregation
- [ ] Sensitivity tagging system: personal / work-adjacent / confidential classification
- [ ] Audit log review interface: see what the agent has been doing and why
- [ ] Breach runbook: documented, tested, executable from phone

## Ongoing — Refinement

- [ ] Preference refinement: system gets better at prioritization, tone, timing
- [ ] Household management module: maintenance schedules, registration reminders
- [ ] Goal tracking: long-arc progress monitoring, stalled-intention detection (builds on task & project engine)
- [ ] Additional ingestion sources as needs arise
- [ ] Periodic reprocessing: as better models/tools emerge, rebuild derived layers from archive

## Future — Draft & Act capabilities

These capabilities require the assistant to act on your behalf. They get built when the core system is running reliably and generating real daily value.

- [ ] Email drafting: compose replies in your voice for review before sending
- [ ] Expand integrations from read-only to draft/propose permissions
- [ ] Agent-delegated subtasks: agent autonomously picks up research and other tasks from the project engine
