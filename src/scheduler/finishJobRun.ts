import { db } from "@/db.ts";

export interface FinishJobRunArgs {
  runId: string;
  status: "ok" | "failed";
  detail?: Record<string, unknown>;
  error?: string;
}

export async function finishJobRun(args: FinishJobRunArgs): Promise<void> {
  await db`
    UPDATE job_runs SET
      status      = ${args.status},
      detail      = ${db.json((args.detail ?? {}) as never)},
      error       = ${args.error ?? null},
      finished_at = now()
    WHERE id = ${args.runId}
  `;
}
