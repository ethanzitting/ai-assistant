ALTER TABLE events
    ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Chicago',
    ADD COLUMN IF NOT EXISTS reminder_offsets_minutes JSONB NOT NULL DEFAULT '[0]'::jsonb;

UPDATE events
SET reminder_offsets_minutes = jsonb_build_array(lead_time_days * 1440)
WHERE lead_time_days IS NOT NULL
  AND reminder_offsets_minutes = '[0]'::jsonb;

CREATE TABLE IF NOT EXISTS event_occurrences (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id       UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    due_at         TIMESTAMPTZ NOT NULL,
    event_at       TIMESTAMPTZ NOT NULL,
    offset_minutes INTEGER NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'unresolved', 'resolved')),
    notified_at    TIMESTAMPTZ,
    resolved_at    TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (event_id, due_at)
);

CREATE INDEX IF NOT EXISTS idx_event_occurrences_due
    ON event_occurrences (due_at) WHERE status IN ('pending', 'unresolved');

ALTER TABLE reminders
    ADD COLUMN IF NOT EXISTS occurrence_id UUID REFERENCES event_occurrences(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_occurrence_time
    ON reminders (occurrence_id, remind_at) WHERE occurrence_id IS NOT NULL;

UPDATE events
SET status = 'missed'
WHERE status = 'active'
  AND type IN ('fixed', 'deadline')
  AND next_due_at < now();

WITH migrated AS (
    INSERT INTO event_occurrences (event_id, due_at, event_at)
    SELECT id, next_due_at, COALESCE(deadline, dtstart, next_due_at)
    FROM events
    WHERE status = 'active' AND next_due_at IS NOT NULL
    ON CONFLICT (event_id, due_at) DO NOTHING
    RETURNING id, event_id, due_at
)
INSERT INTO reminders (event_id, occurrence_id, remind_at)
SELECT event_id, id, due_at FROM migrated;

UPDATE events
SET next_due_at = NULL
WHERE status = 'active' AND type IN ('fixed', 'deadline');

INSERT INTO scheduled_jobs (name, interval_seconds, next_run_at)
VALUES ('reminder_delivery', 60, now())
ON CONFLICT (name) DO NOTHING;

INSERT INTO scheduled_jobs (name, interval_seconds, daily_at_local_time, timezone, next_run_at)
VALUES ('reminder_digest', NULL, '08:00', 'America/Chicago',
        next_daily_run('08:00', 'America/Chicago'))
ON CONFLICT (name) DO NOTHING;
