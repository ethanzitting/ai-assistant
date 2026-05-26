# Event & Cadence Engine

The "clock" primitive — handles scheduling, reminders, and recurring tasks. Overview in [primitives.md](primitives.md).

## Priority system

Every event has a priority that controls how aggressively the agent reminds you:

- **High.** Escalates across channels and repeats until acknowledged. Missed deadlines with real consequences (bills, registrations, expirations).
- **Medium.** Surfaces in the daily briefing and sends a notification at the appropriate time. Most events live here.
- **Low.** Surfaces once in the daily briefing and waits. No push notification unless you ask.

Priority can be set explicitly per event or inherited from its category (see reminder rules below).

## Event types

### Fixed events

One-time, date-specific. Dentist appointment June 12 at 2pm. Car registration due October 31.

### Deadline-driven sequences

The event has a hard deadline and a lead-time offset — the reminder fires based on how far in advance you need to act, not when the deadline itself hits. Passport expires in 6 months, but renewal should start at the 3-month mark.

## Reminder rules

Every event gets reminders through one of two paths:

- **Custom reminders.** Specific times or offsets you define for that event. *"Remind me 2 weeks before, then again 3 days before."*
- **Category defaults.** Events belong to a category (e.g. "medical appointments," "bills," "maintenance") that has default reminder offsets. *"Medical appointments always get a 1-week and 1-day reminder."*

Custom reminders override category defaults. If an event has neither, it falls back to a global default based on its priority.

## Recurring event types

Two distinct recurrence models that behave differently when you miss one:

### Fixed-schedule recurring

Happens on a calendar rhythm regardless of whether you completed the last one. *"Trash goes out every Thursday."* If you miss Thursday, the next occurrence is still next Thursday — the schedule is anchored to the calendar, not to your actions.

A missed occurrence doesn't vanish. It becomes an **unresolved item** that the assistant tracks and surfaces until you explicitly resolve it: reschedule, skip this one, mark done, or remove the reminder entirely. Low-stakes misses (trash day) might only need a brief mention in the next briefing; high-stakes misses (dentist appointment) escalate based on priority until acknowledged.

### Interval-from-completion recurring

Needs at least N days/weeks/months between occurrences. *"Change furnace filter every 90 days."* *"Dentist every 6 months."* If you're 2 weeks late on the furnace filter, the next one is due 90 days from when you *actually did it*, not from when it was originally due. Completing the task resets the timer.

Both types require explicit resolution when missed — the assistant doesn't silently drop anything. The distinction matters for *scheduling*: a missed fixed-schedule event keeps the calendar rhythm intact (next trash day is still Thursday), while a completed interval-from-completion event resets the timer from when you actually did it. Both escalate reminders for unresolved misses based on their priority.

### Computed column: `next_due_at`

The `events` table includes a `next_due_at TIMESTAMPTZ` column that caches the next due date for recurring and deadline events. Application code updates it whenever an event is completed or a recurrence is computed. This makes "what's due this week" a simple `WHERE next_due_at <= $end_of_week` query instead of computing the next occurrence for every active recurring event at query time. The daily briefing skill and event processing loop both benefit from this — it turns an O(N) recurrence computation into an indexed lookup.

## Conditional triggers

Remind based on state changes, not dates. *"When checking balance drops below $2,000."* *"If I haven't heard back from the contractor in 5 days."*

These require the system to periodically evaluate conditions against current state — either by polling data sources or by checking after new data is ingested.

> **Open question:** Conditional triggers need a polling/eval loop. Designed alongside the reasoning layer or as its own scheduler?
