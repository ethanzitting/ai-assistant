import { db } from "@/db.ts";
import { financeAuditStatus } from "@/finance/financeAuditStatus.ts";
import type { FinanceAuditStartResult } from "@/finance/financeAuditTypes.ts";

export async function startFinanceAudit(
  startDate: string,
  endDate: string,
): Promise<FinanceAuditStartResult> {
  const active = await db`
    SELECT id FROM finance_audits WHERE status = 'active' LIMIT 1
  ` as unknown as { id: string }[];
  if (active.length > 0) {
    const activeStatus = (await financeAuditStatus(active[0].id))!;
    if (activeStatus.status === "active") {
      return { created: false, status: activeStatus };
    }
  }

  const auditId = await db.begin(async (tx) => {
    const [{ id }] = await tx`
      INSERT INTO finance_audits (start_date, end_date)
      VALUES (${startDate}, ${endDate})
      RETURNING id
    ` as unknown as [{ id: string }];

    await tx`
      INSERT INTO finance_audit_items (
        audit_id, transaction_id, original_category,
        original_category_source, original_needs_category
      )
      SELECT ${id}, id, category, category_source, needs_category
      FROM transactions
      WHERE posted_date BETWEEN ${startDate} AND ${endDate}
        AND transaction_type = 'expense'
        AND category = 'Unsorted'
        AND NOT pending
        AND removed_at IS NULL
    `;

    await tx`
      UPDATE transactions t
      SET needs_category = true, updated_at = now()
      FROM finance_audit_items i
      WHERE i.audit_id = ${id} AND i.transaction_id = t.id
    `;

    return id;
  });

  return { created: true, status: (await financeAuditStatus(auditId))! };
}
