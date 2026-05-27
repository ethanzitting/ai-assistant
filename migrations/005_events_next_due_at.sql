ALTER TABLE events ADD COLUMN IF NOT EXISTS next_due_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_events_next_due ON events(next_due_at) WHERE status = 'active';
