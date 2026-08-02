import { db } from "@/db.ts";
import { userTimezone } from "@/userTimezone.ts";

// Claiming and rescheduling are one statement, so a job cannot run twice even if two agent
// processes tick at the same moment — the loser's UPDATE matches nothing. next_run_at advances
// before the work starts, which means a job that crashes waits for its next slot instead of
// retrying in a tight loop.
//
// Two cadences. An interval job advances from now(), which is right for "every six hours" and
// drifts harmlessly. A daily job advances to the next occurrence of its wall-clock time in its own
// timezone — computed by Postgres rather than in TypeScript so it stays inside the same atomic
// statement, and so it survives DST without arithmetic of ours.
export async function claimDueJobs(): Promise<string[]> {
  const fallbackTimezone = userTimezone();

  const rows = await db`
    UPDATE scheduled_jobs
    SET last_run_at = now(),
        next_run_at = CASE
          WHEN daily_at_local_time IS NULL
            THEN now() + make_interval(secs => interval_seconds)
          ELSE next_daily_run(daily_at_local_time, COALESCE(timezone, ${fallbackTimezone}))
        END
    WHERE enabled AND next_run_at <= now()
    RETURNING name
  ` as unknown as { name: string }[];

  return rows.map((row) => row.name);
}
