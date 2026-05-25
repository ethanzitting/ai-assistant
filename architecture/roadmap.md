# Roadmap

Phased implementation plan. Each month builds on the previous one; each checkbox is a shippable unit of work.

## Month 1 — Foundation

The goal is a running system that ingests data, stores it, and produces a daily briefing.

- [ ] Docker Compose stack running locally (Postgres + pgvector, app server)
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
- [ ] Prompt injection defense: ingestion/action agent separation, structural prompt sandboxing, classifier filter
- [ ] Voice memo ingestion: Whisper API transcription → processing pipeline
- [ ] Conversation memory: assistant remembers past interactions, builds preference profile
- [ ] Event & cadence engine: recurring reminders, deadline sequences, basic conditional triggers
- [ ] Task & project engine: task CRUD via Telegram, status tracking, surfacing policy, project grouping
- [ ] Archive embedding index: comprehensive secondary index over all originals
- [ ] Pruning job v1: hot → warm tier summarization for emails
- [ ] Google Drive integration: personal documents ingested and archived

## Month 3 — Smarter Tier 1

The goal is a system that gets noticeably better at surfacing the right information at the right time.

- [ ] Proactive pattern recognition: detect repeated behaviors, stalled intentions, scheduling conflicts
- [ ] Financial awareness: at minimum CSV transaction import, ideally Plaid API for balance checking (read-only)
- [ ] Multi-channel output: priority/length/context classification for notifications
- [ ] Smartwatch notifications: Apple Watch as glanceable output channel
- [ ] Meeting prep surfacing: pulling context from knowledge graph + recent interactions before scheduled meetings
- [ ] Pruning job v2: warm → cold transitions, periodic summary aggregation
- [ ] Sensitivity tagging system: personal / work-adjacent / confidential classification
- [ ] Audit log review interface: see what the agent has been doing and why
- [ ] Breach runbook: documented, tested, executable from phone

## Ongoing — Tier 1 refinement

- [ ] Preference refinement: system gets better at prioritization, tone, timing
- [ ] Household management module: maintenance schedules, registration reminders
- [ ] Goal tracking: long-arc progress monitoring, stalled-intention detection (builds on task & project engine)
- [ ] Additional ingestion sources as needs arise
- [ ] Periodic reprocessing: as better models/tools emerge, rebuild derived layers from archive

## Future — Tier 2+ (not before Year 2)

These capabilities require the assistant to act on your behalf. They are out of scope until Tier 1 has been running reliably for at least a year and trust is established.

- [ ] Email drafting: compose replies in your voice for review before sending
- [ ] Research & decision support: web searches, comparison matrices, option gathering
- [ ] Expand integrations from read-only to draft/propose permissions
- [ ] gVisor sandboxing: required if agent code execution capabilities are added
