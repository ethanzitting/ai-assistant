import { db } from "@/db.ts";
import type { FinanceAuditStatus } from "@/finance/financeAuditTypes.ts";

interface AuditStatusRow {
  id: string;
  start_date: Date;
  end_date: Date;
  status: FinanceAuditStatus["status"];
  total: number;
  completed: number;
  remaining: number;
  changes: number;
}

export async function financeAuditStatus(
  auditId?: string,
): Promise<FinanceAuditStatus | null> {
  const rows = await db`
    SELECT a.id, a.start_date, a.end_date, a.status,
      count(DISTINCT i.transaction_id)::int AS total,
      count(DISTINCT i.transaction_id) FILTER (
        WHERE t.removed_at IS NOT NULL OR NOT t.needs_category
      )::int AS completed,
      count(DISTINCT i.transaction_id) FILTER (
        WHERE t.removed_at IS NULL AND t.needs_category
      )::int AS remaining,
      count(DISTINCT c.id)::int AS changes
    FROM finance_audits a
    LEFT JOIN finance_audit_items i ON i.audit_id = a.id
    LEFT JOIN transactions t ON t.id = i.transaction_id
    LEFT JOIN transaction_category_changes c ON c.audit_id = a.id
    WHERE (${auditId ?? null}::uuid IS NULL OR a.id = ${auditId ?? null})
    GROUP BY a.id
    ORDER BY (a.status = 'active') DESC, a.created_at DESC
    LIMIT 1
  ` as unknown as AuditStatusRow[];
  if (rows.length === 0) return null;

  const row = rows[0];
  const status = row.status === "active" && row.remaining === 0
    ? "completed"
    : row.status;
  if (status === "completed" && row.status === "active") {
    await db`
      UPDATE finance_audits SET status = 'completed', completed_at = now()
      WHERE id = ${row.id} AND status = 'active'
    `;
  }

  return {
    auditId: row.id,
    startDate: row.start_date.toISOString().slice(0, 10),
    endDate: row.end_date.toISOString().slice(0, 10),
    status,
    total: row.total,
    completed: row.completed,
    remaining: row.remaining,
    changes: row.changes,
  };
}
