INSERT INTO scheduled_jobs (
    name, interval_seconds, daily_at_local_time, timezone, next_run_at
)
VALUES (
    'plaid_balance_refresh', NULL, '06:00', 'America/Chicago',
    next_daily_run('06:00', 'America/Chicago')
)
ON CONFLICT (name) DO UPDATE SET
    interval_seconds = NULL,
    daily_at_local_time = EXCLUDED.daily_at_local_time,
    timezone = EXCLUDED.timezone,
    next_run_at = EXCLUDED.next_run_at,
    enabled = true;
