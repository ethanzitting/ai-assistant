import { db } from "@/db.ts";

const LOOKBACK = 10;

// How many finished runs failed in an unbroken streak, most recent first. The run in progress is
// still 'running' and so is not counted, which lets a caller ask "does my failure make it three?".
export async function countRecentFailures(jobName: string): Promise<number> {
  const rows = await db`
    SELECT status FROM job_runs
    WHERE job_name = ${jobName} AND status IN ('ok', 'failed')
    ORDER BY started_at DESC
    LIMIT ${LOOKBACK}
  ` as unknown as { status: string }[];

  let streak = 0;
  for (const row of rows) {
    if (row.status !== "failed") break;
    streak++;
  }

  return streak;
}
