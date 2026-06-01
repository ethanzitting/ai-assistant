# Roadmap

Phased implementation plan. Version 1 is deliberately minimal — get it working and generating real feedback. Later versions are reprioritized based on what actually matters after using the system daily.

## Version 1 — Talking Chatbot

A conversational agent on Digital Ocean that can set reminders, transcribe voice and video messages, OCR photos and documents, remember facts, semantically search its memory and archived files, and hold context across a conversation. Running locally and generating real feedback — Phases 1-3 and 5 complete, and the semantic-search half of V2's embedding pipeline landed early (agent-container, `gemini-embedding-001`). Knowledge graph seeding in progress through organic conversation. Detailed plan: [version-one.md](version-one.md).

## Version 2 — Memory, Email & Safety

A system that remembers across conversations, processes your email, and has real security boundaries. Prioritized based on Version 1 feedback. Detailed plan: [version-two.md](version-two.md).

## Version 3 — Smarter & More Useful

The goal is a system that gets noticeably better at surfacing the right information at the right time.

- [ ] Sandbox container: Deno runtime, LLM-generated code execution against read-only data slices, PDF parsing
- [ ] Entity enrichment: contacts, projects enriched with extracted facts across all sources
- [ ] RAG retrieval pipeline: queries search pgvector + knowledge graph tables, assemble context for LLM
- [ ] Proactive pattern recognition: detect repeated behaviors, stalled intentions, scheduling conflicts
- [ ] Financial awareness: dedicated `transactions` table (not knowledge graph facts), `query_finances` tool with aggregation/comparison/projection, CSV import via Telegram, receipt photo OCR with line item extraction, transaction deduplication across sources, LLM-assigned categories with preference learning. Scoped to liquid cash accounts only. Plaid API (read-only) as a later addition. See [workflow-financial-tracking.md](workflow-financial-tracking.md)
- [ ] Ad-hoc data analysis: natural language queries that generate and execute code in the sandbox (e.g., *"show me spending outliers"*)
- [ ] Mid-day event surfacing: proactive notifications and silent context injection for events arriving between daily prefix rebuilds
- [ ] Meeting prep surfacing: pulling context from knowledge graph + recent interactions before scheduled meetings
- [ ] File store integration: Google Drive as ingestion source, file cataloging in knowledge graph (B2 archival already operational from V1)
- [ ] Photo OCR pipeline for physical mail and receipts (receipt processing designed in [workflow-financial-tracking.md](workflow-financial-tracking.md))
- [ ] Multi-channel output: priority/length/context classification for notifications
- [ ] Sensitivity tagging system: normal / confidential classification
- [ ] Pruning job v2: warm → cold transitions, periodic summary aggregation

## Ongoing — Refinement

- [ ] Preference refinement: system gets better at prioritization, tone, timing
- [ ] Household management module: maintenance schedules, registration reminders
- [ ] Goal tracking: long-arc progress monitoring, stalled-intention detection (builds on task & project engine)
- [ ] Smartwatch notifications: Apple Watch as glanceable output channel
- [ ] Research & fact-checking: steelman/flaw analysis, living fact-check cache in knowledge graph (builds on web search from Version 2)
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
