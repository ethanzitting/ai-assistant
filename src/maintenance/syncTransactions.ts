// syncTransactions — run the Plaid sync once, now, instead of waiting for the scheduler.
//
// Same handler and same job_runs bookkeeping as the scheduled run, so a hand-run sync is
// indistinguishable from an automatic one in the history.
//
// Run inside the agent container:  make sync-transactions
import { db } from "@/db.ts";
import { runJob } from "@/scheduler/runJob.ts";

await runJob("plaid_sync");

const [summary] = await db`
  SELECT status, detail, error FROM job_runs
  WHERE job_name = 'plaid_sync'
  ORDER BY started_at DESC
  LIMIT 1
` as unknown as [{ status: string; detail: Record<string, unknown>; error: string | null }];

console.log(`Status: ${summary.status}`);
if (summary.error) console.error(`Error: ${summary.error}`);
console.log(JSON.stringify(summary.detail, null, 2));

await db.end();
