# Core Architectural Primitives

The system is not built as features — it's built as composable primitives that features in [vision.md](vision.md) are configured on top of. There are seven.

This file gives the overview. Each primitive is a candidate to split into its own file as it gets designed in detail.

## 1. The Knowledge Graph ("the memory")

A structured, evolving model of your life. Entities (people, accounts, contracts, projects), facts about them, and how they connect — with temporal validity so you can query what's true now or what was true at any point.

The primary value is recall: *"What did the landscaper's contract say about the cancellation clause?"* *"When did I last file that insurance claim, and what was the outcome?"* *"What were the key decisions from last quarter's financial review?"* Emails, contracts, research results, logged actions, and historical events are the core of what gets tracked. Contacts and relationships are part of the graph but not the focus.

Implementation lives in [data-architecture.md](data-architecture.md) — modeled as Postgres tables (entities, relationships, facts) with temporal validity windows.

## 2. The Event & Cadence Engine ("the clock")

Handles scheduling, reminders, and recurring tasks. Supports fixed events, deadline-driven sequences, two recurrence models (fixed-schedule vs. interval-from-completion), conditional triggers, and a priority system that controls how aggressively the agent reminds you.

Full design in [event-engine.md](event-engine.md).

## 3. The Task & Project Engine ("the hands")

Tracks what you intend to do — open-ended tasks, multi-step projects, and long-arc goals — independent of whether they have a deadline. The event engine handles *when*; this primitive handles *what* and *whether it's done*.

**Tasks** are individual units of work. Each has a status (open, in-progress, waiting, done, dropped), a priority, optional context (links, notes, related entities in the knowledge graph), and a **surfacing policy** that controls how often the assistant brings it up: every daily briefing, weekly review only, or on-demand. Tasks without deadlines don't disappear — they surface on their policy's cadence until explicitly resolved.

**Projects** group related tasks under a shared goal. *"Build a dog house"* is a project; *"research lumber options,"* *"find plans online,"* and *"buy materials"* are its tasks. Projects can be broken down incrementally — you don't need the full task list upfront. The assistant can suggest breakdowns, and eventually take on research subtasks itself.

**Goals** are lightweight long-arc markers that projects and tasks roll up into. *"Read 24 books this year"* is a goal; individual books are tasks. The assistant tracks progress and flags stalls (*"You're at 6 and it's June"*).

The data model is intentionally simple now — status, priority, parent project, surfacing policy — but doesn't prevent adding assignees, dependencies, or delegation tracking as the agent's capabilities grow.

## 4. The Ingestion & Integration Layer ("the senses")

Connects to external data sources, normalizes data, and feeds it into the knowledge graph and event engine. Supports both structured integrations (APIs, OAuth) and unstructured parsing (extracting a date from a school email).

Currently all integrations are read-only. Write access (drafting, booking, sending) gets added per-integration as trust develops. See [trust-model.md](trust-model.md).

Sources, work-data boundary, and quick-capture channels are detailed in [ingestion.md](ingestion.md).

Also handles web fetching for research flows and file ingestion (email attachments, Telegram documents, PDFs). All ingested files are stored in the file store and cataloged in the knowledge graph.

**Architectural constraint:** the ingestion layer runs as a **separate container** from the core system. It can only emit structured records through a schema-validated channel — it cannot read the knowledge graph, modify preferences, or trigger actions. This prevents prompt injection in ingested content from causing unintended side effects. See [security.md](security.md).

## 5. The Reasoning & Prioritization Layer ("the judgment")

LLM-powered core that transforms raw information into actionable intelligence. Handles triage, conflict detection, pattern recognition, synthesis, and relevance filtering.

Knows not just that three bills total $2,400 and your balance is $1,800, but that *this is a problem requiring your attention*.

Query-time context assembly for this layer is detailed in [data-architecture.md](data-architecture.md).

## 6. The Communication Interface ("the voice")

How the assistant talks to you and how you talk to it. Manages both inbound (your questions, instructions, corrections) and outbound (proactive surfacing).

Critical design decision: modality and timing. Some things are a morning briefing, some are immediate alerts, some wait until asked.

Multiple output channels (Telegram, smartwatch, AirPods, desktop) are detailed in [interfaces.md](interfaces.md).

## 7. The Preference & Feedback Loop ("the learning")

Captures every correction, override, and expressed preference and feeds it back into the knowledge graph and reasoning layer.

*"Don't remind me about that on weekends."* *"That email was actually important, not low priority."* *"I liked that restaurant suggestion."*

Explicit mechanism for the assistant to get better over time. Preference distillation from LLM interaction logs is described in [data-lifecycle.md](data-lifecycle.md).
