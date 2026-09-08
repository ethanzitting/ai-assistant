import { db } from "@/db.ts";
import { error } from "@/logger.ts";

export async function trace(
  traceId: string,
  step: string,
  detail: Record<string, unknown> = {},
): Promise<boolean> {
  try {
    await db`
      INSERT INTO engine_trace (trace_id, step, detail)
      VALUES (${traceId}, ${step}, ${db.json(detail as never)})
    `;
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    error("trace", `Failed to write trace: ${message}`, { traceId, step });
    return false;
  }
}
