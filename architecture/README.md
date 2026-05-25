# Architecture

Living architecture for the personal AI assistant. Each file covers one concern and is meant to be refined independently. `PLAN.md` and `INTERFACE.md` in the repo root are the original brain-dump; this directory is the structured version we'll build on.

## Reading order

For someone new to the project:

1. [vision.md](vision.md) — what we're building and why
2. [trust-model.md](trust-model.md) — how much autonomy the assistant has
3. [primitives.md](primitives.md) — the seven conceptual building blocks
   - [event-engine.md](event-engine.md) — scheduling, reminders, recurrence models (split from primitives)
4. [data-architecture.md](data-architecture.md) — storage layers and retrieval
5. [data-lifecycle.md](data-lifecycle.md) — how data ages and gets compressed
6. [context-assembly.md](context-assembly.md) — how stored data becomes prompt context
7. [ingestion.md](ingestion.md) — what comes in, and what doesn't
8. [interfaces.md](interfaces.md) — how the assistant talks to you
9. [infrastructure.md](infrastructure.md) — where it runs and what it costs
10. [security.md](security.md) — threat model and defenses
11. [roadmap.md](roadmap.md) — phased build plan

Reference material (not load-bearing):

- [tech-stack.md](tech-stack.md) — chosen technologies + learning notes
- [landscape.md](landscape.md) — competitive context

## Source mapping

Where each section of the original docs lives now:

| Source | Destination |
|---|---|
| PLAN §1 Vision | [vision.md](vision.md) |
| PLAN §2 Feature Domains | [vision.md](vision.md) |
| PLAN §3 Trust & Autonomy | [trust-model.md](trust-model.md) |
| PLAN §4 Core Architectural Primitives | [primitives.md](primitives.md) |
| PLAN §5 Technical Architecture (data layers, archive, query assembly) | [data-architecture.md](data-architecture.md) |
| PLAN §6 Data Lifecycle | [data-lifecycle.md](data-lifecycle.md) |
| PLAN §7 Hosting & Infrastructure | [infrastructure.md](infrastructure.md) |
| PLAN §8 Security Architecture | [security.md](security.md) |
| PLAN §9 Realistic Data Inputs & Work Data Boundaries | [ingestion.md](ingestion.md) |
| PLAN §10 Output Channels & G2 | [interfaces.md](interfaces.md) |
| PLAN §11 Competitive Landscape | [landscape.md](landscape.md) |
| PLAN §12 Learning Path & Tech Stack | [tech-stack.md](tech-stack.md) |
| PLAN §13 Implementation Timeline | [roadmap.md](roadmap.md) |
| PLAN §14 Key Design Decisions & Principles | [vision.md](vision.md) |
| INTERFACE.md (prototype I/O) | [interfaces.md](interfaces.md) |

## Conventions

- One concern per file. If a file grows past ~400 lines, split it.
- Cross-link with relative markdown links so refactors are cheap.
- Mark unresolved questions with `> **Open question:** ...` blockquotes so they're easy to grep.
- Mark decisions with `> **Decision (YYYY-MM-DD):** ...` so the rationale survives.
- When a file gets refined, leave the original PLAN.md untouched — it's the historical brain-dump, not a living doc.

## Likely future splits

These are flagged now so we don't have to rediscover them:

- **`primitives.md`** — the remaining primitives (Knowledge Graph, Task & Project Engine, Ingestion, Reasoning, Communication, Feedback Loop) are natural per-file splits once they get designed in detail. Event Engine has already been split to [event-engine.md](event-engine.md).
- **`vision.md`** — §2's 11 feature domains may each warrant their own file once we start picking which ones to build first.
- **`ingestion.md`** — per-source integration design (Gmail, Calendar, Telegram, voice memos, OCR) may split out as each is implemented.
- **`context-assembly.md`** — formatting rules per knowledge type and the compaction pipeline may warrant their own files as implementation details solidify.
