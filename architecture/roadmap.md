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
- [ ] Basic daily briefing: *"Here's what's on your calendar, here are important emails, here are reminders"*
- [ ] Agent safety controls: circuit breakers (budget caps, loop detection, scope enforcement) + kill switch
- [ ] Backup scripts: pg_dump → encrypted → object storage
- [ ] WireGuard VPN setup
- [ ] Deploy to VPS

## Month 2 — Knowledge & Memory

The goal is a system that remembers, connects dots, and retrieves context intelligently.

- [ ] Knowledge graph population: entities and facts extracted from email and note ingestion
- [ ] Relationship model: contacts enriched with extracted facts, interaction history, relationship metadata
- [ ] RAG retrieval pipeline: queries search pgvector + knowledge graph tables, assemble context for LLM
- [ ] Prompt injection defense: ingestion/action agent separation, structural prompt sandboxing, classifier filter
- [ ] Voice memo ingestion: Whisper API transcription → processing pipeline
- [ ] Conversation memory: assistant remembers past interactions, builds preference profile
- [ ] Event & cadence engine: recurring reminders, deadline sequences, basic conditional triggers
- [ ] Archive embedding index: comprehensive secondary index over all originals
- [ ] Pruning job v1: hot → warm tier summarization for emails
- [ ] Google Drive integration: personal documents ingested and archived

## Month 3 — Intelligence & Output

The goal is a system that reasons proactively, surfaces insights, and reaches you on the right channel.

- [ ] Reasoning layer: proactive pattern recognition, conflict detection, priority triage
- [ ] Financial integration: at minimum CSV transaction import, ideally Plaid API for balance checking
- [ ] Multi-channel output: priority/length/context classification for notifications
- [ ] Even Realities G2 integration: Even Hub app as thin client for assistant notifications
- [ ] R1 ring quick-capture: tap to trigger voice input directly to assistant
- [ ] Meeting prep assembly: pulling context from knowledge graph + recent interactions before scheduled meetings
- [ ] Pruning job v2: warm → cold transitions, periodic summary aggregation, transcript summarization
- [ ] Sensitivity tagging system: personal / work-adjacent / confidential classification
- [ ] Caddy reverse proxy: automatic HTTPS, domain routing for co-hosted projects
- [ ] Audit log review interface: see what the agent has been doing and why
- [ ] Breach runbook: documented, tested, executable from phone
- [ ] gVisor sandboxing: if agent code execution capabilities are added, sandbox with `runsc`

## Ongoing

- [ ] Preference refinement: system gets better at prioritization, tone, timing
- [ ] Additional integrations as trust builds: expand from Tier 1 toward selective Tier 2 capabilities
- [ ] Household management module: maintenance schedules, registration reminders
- [ ] Goal tracking module: long-arc progress monitoring
- [ ] Periodic reprocessing: as better models/tools emerge, rebuild derived layers from archive
