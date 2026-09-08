import { plaidSyncJob } from "@/finance/plaidSyncJob.ts";
import { categorizationPromptJob } from "@/finance/categorizationPromptJob.ts";
import { reminderDeliveryJob } from "@/events/reminderDeliveryJob.ts";
import { reminderDigestJob } from "@/events/reminderDigestJob.ts";
import type { EventQueue } from "@/engine/eventQueue.ts";

// A job is plain code on a clock, not a conversation turn. The handler receives its own registered
// name so it can read its own history in job_runs, and returns whatever detail is worth recording.
export type JobHandler = (
  jobName: string,
  queue?: EventQueue,
) => Promise<Record<string, unknown>>;

const handlersByName = new Map<string, JobHandler>([
  ["plaid_sync", plaidSyncJob],
  ["categorization_prompts", categorizationPromptJob],
  ["reminder_delivery", reminderDeliveryJob],
  ["reminder_digest", reminderDigestJob],
]);

export function getJobHandler(jobName: string): JobHandler | undefined {
  return handlersByName.get(jobName);
}
