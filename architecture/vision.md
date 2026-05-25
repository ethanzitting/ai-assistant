# Vision

What we're building, what it covers, and the principles that constrain how we build it.

## What this is

A personal AI assistant that approaches the usefulness of a skilled human assistant — one that understands the full context of your life, proactively surfaces what matters, and gets smarter over time. It is built by you, for you: opinionated, tailored, and incrementally extensible. It is not a product; it is personal infrastructure.

The goal is to reduce the cognitive overhead of life — tracking the things you know you should be doing but can't hold in your head simultaneously, and connecting dots across domains (relationships, finances, calendar, health, household) that siloed apps never will.

## Feature domains

These are the areas the assistant should eventually cover. They are not all in scope for the first version; see [roadmap.md](roadmap.md) for sequencing. Each domain is a candidate to split into its own file as it gets designed in detail.

### Relationship management
- Maintain a contact graph: who people are, how you relate to them, and key facts about them.
- Track birthdays, anniversaries, and occasions. Surface reminders with enough lead time to act.
- Context will be inherently lightweight — the system learns from emails, calendar events, and what you manually capture, not from recording calls or taking notes during conversations. This is a contacts-plus tool, not a CRM.

### Calendar & schedule management
- Unified view across personal and work calendars (work calendar via a separate sharing path — see [ingestion.md](ingestion.md)).
- Conflict detection — not just time overlaps, but logistical conflicts (meeting across town 15 minutes after another meeting).
- Buffer awareness — flagging packed days with no breaks.
- Meeting preparation: *"You're meeting with James tomorrow. Last time you discussed the Q3 timeline. He had an action item to get back to you on vendor pricing."*

### Communication triage
- Email triage: flag what's urgent, summarize routine messages, surface buried important items.
- Follow-up tracking: *"You emailed the contractor 5 days ago and never heard back."*
- Drafting and sending on your behalf comes later — out of scope until the core system is running reliably and generating real value.

### Financial awareness
- Track upcoming bills and due dates.
- Conditional alerts: *"Three bills totaling $2,400 land Friday. Checking account balance is $1,800."*
- Pattern recognition: recurring charges, unusual transactions, late fee risks.
- No autonomous spending authority — observe and inform only.

### Document & information management
- *"Where's that contract we signed with the landscaper?"*
- Contextual retrieval across all stored documents and conversations.
- Meeting prep assembly from past interactions and documents.

### Health & wellness logistics
- Appointment tracking and cadence reminders (dentist every 6 months, annual physical).
- Prescription refill awareness.
- Provider contact and insurance detail storage.
- Not medical advice — logistics only.

### Household management
- Recurring maintenance tracking: furnace filter, gutter cleaning, car registration, pet vet appointments.
- The "death by a thousand cuts" tasks that individually are trivial but collectively create enormous mental load.

### Tasks, projects & goal tracking
- Open-ended task tracking: *"Study vim,"* *"Read this book for Julian,"* *"Look into breaking into X industry"* — things without hard deadlines that still need to get done.
- Project breakdown: group related tasks, add subtasks incrementally, track progress across a multi-step effort like *"build a dog house."*
- Higher-level accountability: *"You said in January you wanted to read 24 books this year. You're at 6 and it's June."*
- Stalled intention detection: *"You've been talking about refinancing for 3 months but haven't acted."*
- Surfacing on a cadence you choose — daily, weekly, or only when you ask — so nothing falls through the cracks but you're not nagged about low-priority items.

### Research & fact-checking
- Deep research on a topic: steelman both sides, search for flaws, find high-quality sources, summarize findings.
- **Living fact-check cache:** research summaries stored as files and knowledge graph entities, updated when new information emerges. Rapidly pull up a summary during a conversation, then update it later as facts change.
- Gather options for decisions (phone plans, contractors, schools). Build comparison matrices. Present short lists instead of overwhelming open fields.
- All research artifacts (PDFs, studies, summaries) permanently stored in the file system and cataloged in the knowledge graph for future retrieval.
- Requires web search and file creation capabilities — available once the sandbox and ingestion containers support outbound research flows.

### Proactive pattern recognition
- *"You've canceled your gym session 3 weeks in a row — want to move it to a different slot?"*
- *"You always seem stressed after your Thursday afternoon meeting block — want a buffer?"*
- *"You keep getting late fees on that one bill — should we set up autopay?"*

## Design principles

These constrain every decision in the rest of the architecture docs. When two designs seem equally good, the one that respects more of these principles wins.

1. **Build primitives, not features.** Features are configurations of the [core primitives](primitives.md). Don't bake one-off feature logic into the platform.
2. **The knowledge system is a cache; the archive is the truth.** Everything derived can be rebuilt from originals. See [data-architecture.md](data-architecture.md).
3. **Every write is an append.** No destructive updates. Full audit trail. Temporal validity on all facts.
4. **Trust is earned incrementally.** Start with observe-and-inform capabilities. More powerful capabilities (drafting, acting on your behalf) get added when the current system is working well and generating real value. See [trust-model.md](trust-model.md).
5. **Work data stays in work systems.** The assistant knows about work's *impact on your life*, not work's *content*. See [ingestion.md](ingestion.md).
6. **You are the filter for unstructured input.** Manual capture through frictionless channels, informed by your judgment about what's personal vs. proprietary.
7. **Security is not an afterthought.** Assume eventual compromise. Store everything but protect it aggressively — encrypt at rest, segment credentials, isolate containers, plan for containment. See [security.md](security.md).
8. **Non-intrusive output matters.** Optimize for Telegram, smartwatch notifications, and AirPods — channels that surface information without demanding attention. Smart glasses (Even Realities G2) are a future upgrade once the system is generating real daily value. See [interfaces.md](interfaces.md).
9. **Context engineering matters more than model choice.** Getting the right 3,000 tokens into the prompt beats throwing 100K tokens at a bigger context window.
10. **The system should get smarter, not just bigger.** Progressive summarization, preference extraction, and pattern recognition mean the assistant improves even as raw data is compressed away.
