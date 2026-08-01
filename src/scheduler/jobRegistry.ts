import type { JobHandler } from "@/scheduler/jobTypes.ts";
import { plaidSyncJob } from "@/finance/plaidSyncJob.ts";

// Scheduled work runs as code, not through the event queue. A bank sync is deterministic and needs
// no judgment, so routing it through a Claude turn would spend tokens and invite the model to
// improvise over arithmetic. Work that genuinely needs judgment — reminders, a daily briefing —
// belongs here too, but its handler should push a queue event rather than answer for itself.
const handlersByName = new Map<string, JobHandler>([
  ["plaid_sync", plaidSyncJob],
]);

export function getJobHandler(jobName: string): JobHandler | undefined {
  return handlersByName.get(jobName);
}
