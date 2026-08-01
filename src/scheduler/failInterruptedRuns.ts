import { db } from "@/db.ts";
import { warn } from "@/logger.ts";

// finishJobRun is the only writer of a terminal status, so a run killed mid-flight stays 'running'
// forever. A hot reload during a sync does exactly that, routinely. Left alone, a job that crashes
// every single time would produce no 'failed' rows at all, countRecentFailures would never see a
// streak, and the failure would never be reported — the one outcome the reporting exists to prevent.
//
// Nothing can still be running at startup, so every such row is an interrupted run.
export async function failInterruptedRuns(): Promise<void> {
  const rows = await db`
    UPDATE job_runs
    SET status = 'failed', error = 'Interrupted — the agent stopped mid-run', finished_at = now()
    WHERE status = 'running'
    RETURNING job_name
  ` as unknown as { job_name: string }[];

  if (rows.length === 0) return;

  warn("scheduler", "Marked interrupted job runs as failed", {
    count: rows.length,
    jobs: [...new Set(rows.map((row) => row.job_name))].join(", "),
  });
}
