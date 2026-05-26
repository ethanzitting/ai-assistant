CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium',
    dtstart TIMESTAMPTZ,
    dtend TIMESTAMPTZ,
    deadline TIMESTAMPTZ,
    lead_time_days INTEGER,
    recurrence_rule JSONB,
    category TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    last_completed_at TIMESTAMPTZ,
    properties JSONB DEFAULT '{}',
    entity_id UUID REFERENCES entities(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES events(id),
    remind_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_reminders_pending ON reminders(remind_at) WHERE status = 'pending';
