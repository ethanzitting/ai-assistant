import { db } from "@/db.ts";

export async function startJobRun(jobName: string): Promise<string> {
  const [{ id }] = await db`
    INSERT INTO job_runs (job_name, status) VALUES (${jobName}, 'running')
    RETURNING id
  ` as unknown as [{ id: string }];

  return id;
}
