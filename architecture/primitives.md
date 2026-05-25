# Core Architectural Primitives

The system is not built as features — it's built as composable primitives that features in [vision.md](vision.md) are configured on top of. There are six.

This file gives the overview. Each primitive is a candidate to split into its own file as it gets designed in detail.

## 1. The Knowledge Graph ("the memory")

A structured, evolving model of your life. People, places, accounts, preferences, relationships between entities, historical context.

"Sarah" isn't just a contact — she's your sister, lives in Denver, has two kids (ages 7 and 10), works at a nonprofit, you last spoke May 3rd, and she mentioned thinking about moving. Every other system reads from and writes to this graph.

Implementation lives in [data-architecture.md](data-architecture.md) — modeled as Postgres tables (entities, relationships, facts) with temporal validity windows.

## 2. The Event & Cadence Engine ("the clock")

Handles four distinct temporal patterns:

- **Fixed events.** Dentist appointment June 12 at 2pm.
- **Recurring cadences.** Change furnace filter every 90 days. Check in with Dad every two weeks.
- **Deadline-driven sequences.** Passport expires in 6 months, but renewal should start at the 3-month mark, so the reminder fires then.
- **Conditional triggers.** Remind me based on state changes, not dates. *"When checking balance drops below $2,000."* *"When airfare to Denver drops below $300."* *"If I haven't heard back from the contractor in 5 days."*

> **Open question:** Conditional triggers need a polling/eval loop. Designed alongside the reasoning layer or as its own scheduler?

## 3. The Ingestion & Integration Layer ("the senses")

Connects to external data sources, normalizes data, and feeds it into the knowledge graph and event engine. Supports both structured integrations (APIs, OAuth) and unstructured parsing (extracting a date from a school email).

The trust tiers from [trust-model.md](trust-model.md) live here architecturally: Tier 1 = read-only access, Tier 2 = prepare actions, Tier 3 = write access.

Sources, work-data boundary, and quick-capture channels are detailed in [ingestion.md](ingestion.md).

**Architectural constraint:** the ingestion agent (which processes untrusted external content like emails and documents) must be separated from the action agent (which can draft replies or take actions). This prevents prompt injection in ingested content from triggering unintended actions. See [security.md](security.md).

## 4. The Reasoning & Prioritization Layer ("the judgment")

LLM-powered core that transforms raw information into actionable intelligence. Handles triage, conflict detection, pattern recognition, synthesis, and relevance filtering.

Knows not just that three bills total $2,400 and your balance is $1,800, but that *this is a problem requiring your attention*.

Query-time context assembly for this layer is detailed in [data-architecture.md](data-architecture.md).

## 5. The Communication Interface ("the voice")

How the assistant talks to you and how you talk to it. Manages both inbound (your questions, instructions, corrections) and outbound (proactive surfacing).

Critical design decision: modality and timing. Some things are a morning briefing, some are immediate alerts, some wait until asked.

Multiple output channels (G2 glasses, phone, desktop) are detailed in [interfaces.md](interfaces.md).

## 6. The Preference & Feedback Loop ("the learning")

Captures every correction, override, and expressed preference and feeds it back into the knowledge graph and reasoning layer.

*"Don't remind me about that on weekends."* *"That email was actually important, not low priority."* *"I liked that restaurant suggestion."*

Explicit mechanism for the assistant to get better over time. Preference distillation from LLM interaction logs is described in [data-lifecycle.md](data-lifecycle.md).
