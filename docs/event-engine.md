# Event & Cadence Engine

The "clock" primitive — handles scheduling, reminders, and recurring tasks. Overview in [primitives.md](primitives.md). Implementation: `agent/src/events/`.

## Priority system

Every event has a priority that controls how aggressively the agent reminds you:

- **High.** Escalates across channels and repeats until acknowledged. Missed deadlines with real consequences.
- **Medium.** Surfaces in the daily briefing and sends a notification at the appropriate time. Most events live here.
- **Low.** Surfaces once in the daily briefing and waits. No push notification unless you ask.

## Event types

- **Fixed events.** One-time, date-specific. Dentist appointment June 12 at 2pm.
- **Deadline-driven sequences.** Hard deadline with a lead-time offset — the reminder fires based on how far in advance you need to act, not when the deadline hits.

## Reminder rules

Every event gets reminders through one of two paths:

- **Custom reminders.** Specific times or offsets you define for that event.
- **Category defaults.** Events belong to a category with default reminder offsets. Custom reminders override category defaults.

If an event has neither, it falls back to a global default based on its priority.

## Recurring event types

Two distinct recurrence models — implementation in `agent/src/events/recurrence.ts`:

### Fixed-schedule recurring

Happens on a calendar rhythm regardless of completion. *"Trash goes out every Thursday."* If you miss Thursday, the next occurrence is still next Thursday. A missed occurrence becomes an **unresolved item** tracked until explicitly resolved.

### Interval-from-completion recurring

Needs at least N days/weeks/months between occurrences. *"Change furnace filter every 90 days."* Completing the task resets the timer — the next occurrence is computed from the actual completion date.

Both types require explicit resolution when missed. The distinction matters for scheduling: fixed-schedule keeps the calendar rhythm, interval-from-completion resets from actual completion.

### Computed column: `next_due_at`

The `events` table includes `next_due_at TIMESTAMPTZ` that caches the next due date. Application code updates it on completion or recurrence computation. Schema: `migrations/005_events_next_due_at.sql`. This turns "what's due this week" into an indexed lookup instead of computing next occurrence for every active recurring event.

## Conditional triggers

Remind based on state changes, not dates. *"When checking balance drops below $2,000."* *"If I haven't heard back from the contractor in 5 days."*

> **Open question:** Conditional triggers need a polling/eval loop. Designed alongside the reasoning layer or as its own scheduler?
