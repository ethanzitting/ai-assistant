import { db } from "@/db.ts";

export async function cancelFinanceAudit(auditId: string): Promise<number> {
  return await db.begin(async (tx) => {
    const restored = await tx`
      UPDATE transactions t
      SET needs_category = i.original_needs_category, updated_at = now()
      FROM finance_audit_items i
      JOIN finance_audits a ON a.id = i.audit_id
      WHERE i.audit_id = ${auditId}
        AND i.transaction_id = t.id
        AND a.status = 'active'
        AND t.category = i.original_category
        AND t.category_source IS NOT DISTINCT FROM i.original_category_source
        AND t.needs_category IS DISTINCT FROM i.original_needs_category
      RETURNING t.id
    `;

    await tx`
      UPDATE categorization_batch_items b
      SET answered_at = now()
      FROM finance_audit_items i
      WHERE i.audit_id = ${auditId}
        AND i.transaction_id = b.transaction_id
        AND b.answered_at IS NULL
    `;
    await tx`
      UPDATE categorization_batches b SET completed_at = now()
      WHERE b.completed_at IS NULL AND NOT EXISTS (
        SELECT 1 FROM categorization_batch_items i
        WHERE i.batch_id = b.id AND i.answered_at IS NULL
      )
    `;
    await tx`
      UPDATE finance_audits SET status = 'cancelled', completed_at = now()
      WHERE id = ${auditId} AND status = 'active'
    `;

    return restored.length;
  });
}
