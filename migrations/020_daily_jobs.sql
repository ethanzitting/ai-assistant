-- The scheduler was built for intervals: claimDueJobs sets next_run_at = now() + interval_seconds,
-- which drifts a little every run and drifts a lot after downtime. "Every night at eight" needs an
-- anchor instead of an offset.
--
-- When daily_at_local_time is set, interval_seconds is ignored and the next run is the next
-- occurrence of that wall-clock time in the job's timezone, so it stays put across DST and across
-- a container that was down for a day.
ALTER TABLE scheduled_jobs ADD COLUMN IF NOT EXISTS daily_at_local_time TIME;
ALTER TABLE scheduled_jobs ADD COLUMN IF NOT EXISTS timezone TEXT;
ALTER TABLE scheduled_jobs ALTER COLUMN interval_seconds DROP NOT NULL;

ALTER TABLE scheduled_jobs
    ADD CONSTRAINT scheduled_jobs_cadence_check
    CHECK (interval_seconds IS NOT NULL OR daily_at_local_time IS NOT NULL);

-- Kept in SQL rather than TypeScript so the whole claim stays one atomic statement, and so DST is
-- Postgres's problem rather than ours.
CREATE OR REPLACE FUNCTION next_daily_run(at_local TIME, tz TEXT)
RETURNS TIMESTAMPTZ AS $$
DECLARE
    local_now TIMESTAMP := now() AT TIME ZONE tz;
    candidate TIMESTAMP := date_trunc('day', local_now) + at_local;
BEGIN
    IF candidate <= local_now THEN
        candidate := candidate + INTERVAL '1 day';
    END IF;
    RETURN candidate AT TIME ZONE tz;
END;
$$ LANGUAGE plpgsql STABLE;

INSERT INTO scheduled_jobs (name, interval_seconds, daily_at_local_time, timezone, next_run_at)
VALUES ('categorization_prompts', NULL, '20:00', 'America/Chicago',
        next_daily_run('20:00', 'America/Chicago'))
ON CONFLICT (name) DO NOTHING;
