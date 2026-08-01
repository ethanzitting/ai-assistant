import { claimDueJobs } from "@/scheduler/claimDueJobs.ts";
import { runJob } from "@/scheduler/runJob.ts";
import { failInterruptedRuns } from "@/scheduler/failInterruptedRuns.ts";
import { info, error } from "@/logger.ts";

const TICK_MS = 60_000;

// Runs beside the event loop, not inside it. Both are async and share the same connection pool, so
// a long sync never blocks a Telegram turn. Deliberately not awaited by the caller: it never
// returns, and awaiting it would stop the event loop from ever starting.
export function startScheduler(): void {
  info("scheduler", "Scheduler started", { tickSeconds: TICK_MS / 1000 });
  tickForever().catch((err: unknown) => {
    error("scheduler", "Scheduler stopped", {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

async function tickForever(): Promise<void> {
  await settleInterruptedRuns();

  while (true) {
    try {
      for (const jobName of await claimDueJobs()) {
        await runJob(jobName);
      }
    } catch (err: unknown) {
      error("scheduler", "Tick failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await new Promise((resolve) => setTimeout(resolve, TICK_MS));
  }
}

// Best effort. A failure here must not stop the scheduler from ticking — it only costs the
// bookkeeping, not the work.
async function settleInterruptedRuns(): Promise<void> {
  try {
    await failInterruptedRuns();
  } catch (err: unknown) {
    error("scheduler", "Could not settle interrupted runs", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
