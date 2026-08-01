import { runDueJobs } from "@/scheduler/runDueJobs.ts";
import { info, error } from "@/logger.ts";

const TICK_MS = 60_000;

// Runs beside the event loop, not inside it. Both are async and share the same connection pool, so
// a long sync never blocks a Telegram turn. Deliberately not awaited by the caller: it never
// returns, and awaiting it would stop the event loop from ever starting.
export function startScheduler(): void {
  info("scheduler", "Scheduler started", { tickSeconds: TICK_MS / 1000 });
  tickForever();
}

async function tickForever(): Promise<void> {
  while (true) {
    try {
      await runDueJobs();
    } catch (err: unknown) {
      error("scheduler", "Tick failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await new Promise((resolve) => setTimeout(resolve, TICK_MS));
  }
}
