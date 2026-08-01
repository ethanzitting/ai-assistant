import { db } from "@/db.ts";

const STALL_DAYS = 7;

// A stalled feed and a quiet week look identical from the outside, so this states the observation
// rather than claiming a fault. It reports once per episode: the flag written into the previous
// run's detail suppresses the repeat, and a run that finds fresh transactions re-arms it.
export async function detectSyncStall(jobName: string): Promise<string | null> {
  const [{ newest }] = await db`
    SELECT max(posted_date) AS newest FROM transactions WHERE removed_at IS NULL
  ` as unknown as [{ newest: Date | null }];

  if (!newest) return null;

  const daysSince = (Date.now() - newest.getTime()) / 86_400_000;
  if (daysSince < STALL_DAYS) return null;

  if (await alreadyReported(jobName)) return null;

  return `🏦 No new bank transactions for ${Math.floor(daysSince)} days. ` +
    `The connection reports no error, so this may just be a quiet stretch — ` +
    `but if you have been spending, the feed has stalled and needs a look.`;
}

async function alreadyReported(jobName: string): Promise<boolean> {
  const rows = await db`
    SELECT detail->>'stall_reported' AS flag FROM job_runs
    WHERE job_name = ${jobName} AND status = 'ok'
    ORDER BY started_at DESC
    LIMIT 1
  ` as unknown as { flag: string | null }[];

  return rows[0]?.flag === "true";
}
