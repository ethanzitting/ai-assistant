import { plaidSyncJob } from "@/finance/plaidSyncJob.ts";

// A job is plain code on a clock, not a conversation turn. The handler receives its own registered
// name so it can read its own history in job_runs, and returns whatever detail is worth recording.
export type JobHandler = (jobName: string) => Promise<Record<string, unknown>>;

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
