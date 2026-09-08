# Event & Cadence Engine

The clock primitive handles reminders, deadlines, and recurring tasks. The
implementation lives in `src/events/` and runs through the scheduler in
`src/scheduler/`.

## Model

- `events` stores the durable reminder or recurring series.
- `event_occurrences` stores independently resolvable scheduled alerts.
- `reminders` is the delivery outbox and attempt history.

Dismiss, confirm, and complete all resolve the current occurrence. Dropping an
event deletes the future series. Multiple alerts for one deadline are
independent, so resolving an early alert does not cancel later ones.

## Priority behavior

- **High:** sends when due, then every two hours until the occurrence is
  resolved. There are no quiet hours.
- **Medium:** sends when due, then appears in each daily digest until resolved.
- **Low:** sends once when due. A date without a time becomes 8:00 AM.

All reminders are delivered to the owner's private Telegram chat. Delivery
messages are deterministic and consume no model tokens.

## Cadences

- **One-time:** one exact date and time.
- **Deadline sequence:** independent alerts at one or more minute offsets before
  a deadline.
- **Fixed recurring:** advances from the previous scheduled time, regardless of
  when the prior occurrence is resolved.
- **Interval from completion:** advances from the time the current occurrence is
  resolved.
- **Monthly calendar patterns:** nth weekday or first/last Monday-Friday.
  Holiday calendars are not applied.

Cadences support days, weeks, months, and years. Every event carries an IANA
timezone; the default is `America/Chicago`. Calendar arithmetic preserves the
local wall-clock time across DST.

Only one unresolved occurrence is retained when a fixed recurring reminder is
missed repeatedly. Its series continues advancing to the next future schedule.

## Daily digest

At 8:00 AM America/Chicago, a scheduled event asks the primary model to write a
concise digest. It receives every reminder due in the next seven days plus
overdue unresolved medium-priority reminders. The scheduled turn has no tools,
so digest generation cannot mutate reminder state.

## Delivery

The scheduler runs `reminder_delivery` every minute. It atomically claims due
outbox rows, sends them through Telegram with retry, and records successful
delivery. Stale claims return to the pending state after ten minutes. Dropping
or resolving an occurrence cancels its pending deliveries.

Conditional triggers and snoozing are intentionally not implemented.
