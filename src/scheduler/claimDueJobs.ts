import { db } from "@/db.ts";

// Claiming and rescheduling are one statement, so a job cannot run twice even if two agent
// processes tick at the same moment — the loser's UPDATE matches nothing. next_run_at advances
// before the work starts, which means a job that crashes waits for its next slot instead of
// retrying in a tight loop.
export async function claimDueJobs(): Promise<string[]> {
  const rows = await db`
    UPDATE scheduled_jobs
    SET next_run_at = now() + make_interval(secs => interval_seconds),
        last_run_at = now()
    WHERE enabled AND next_run_at <= now()
    RETURNING name
  ` as unknown as { name: string }[];

  return rows.map((row) => row.name);
}
