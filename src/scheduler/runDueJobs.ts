import { claimDueJobs } from "@/scheduler/claimDueJobs.ts";
import { runJob } from "@/scheduler/runJob.ts";

export async function runDueJobs(): Promise<void> {
  for (const jobName of await claimDueJobs()) {
    await runJob(jobName);
  }
}
