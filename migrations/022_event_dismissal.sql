ALTER TABLE events
    ADD CONSTRAINT events_status_check
    CHECK (status IN ('active', 'completed', 'missed', 'dropped', 'dismissed'));
