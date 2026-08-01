import { getJobHandler } from "@/scheduler/jobRegistry.ts";
import { startJobRun } from "@/scheduler/startJobRun.ts";
import { finishJobRun } from "@/scheduler/finishJobRun.ts";
import { info, warn, error } from "@/logger.ts";

// Shared by the scheduler tick and the manual make target, so a hand-run sync lands in job_runs
// with the same bookkeeping as a scheduled one.
export async function runJob(jobName: string): Promise<void> {
  const handler = getJobHandler(jobName);
  if (!handler) {
    warn("scheduler", "No handler registered for job", { jobName });
    return;
  }

  const runId = await startJobRun(jobName);
  info("scheduler", "Running job", { jobName });

  try {
    const detail = await handler(jobName);
    await finishJobRun({ runId, status: "ok", detail });
    info("scheduler", "Job finished", { jobName, ...detail });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    error("scheduler", "Job failed", { jobName, error: message });
    await finishJobRun({ runId, status: "failed", error: message });
  }
}
