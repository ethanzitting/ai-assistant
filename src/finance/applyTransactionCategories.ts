import { db } from "@/db.ts";

export interface TransactionCategoryAssignment {
  transactionId: string;
  category: string;
}

export interface ApplyTransactionCategoriesResult {
  ok: boolean;
  problem?: string;
  assignments?: TransactionCategoryAssignment[];
  queueItemsClosed?: number;
}

export async function applyTransactionCategories(
  assignments: TransactionCategoryAssignment[],
): Promise<ApplyTransactionCategoriesResult> {
  const transactionIds = assignments.map((assignment) =>
    assignment.transactionId
  );
  if (new Set(transactionIds).size !== transactionIds.length) {
    return { ok: false, problem: "Each transaction can have only one answer." };
  }

  const categories = await db`
    SELECT name FROM categories WHERE active ORDER BY sort_order
  ` as unknown as { name: string }[];
  const categoryByLower = new Map(
    categories.map((row) => [row.name.toLowerCase(), row.name]),
  );
  const resolved = assignments.map((assignment) => ({
    transactionId: assignment.transactionId,
    category: categoryByLower.get(assignment.category.toLowerCase()),
  }));
  const unknown = resolved.find((assignment) => !assignment.category);
  if (unknown) {
    return {
      ok: false,
      problem: `Unknown category: ${
        assignments.find((item) => item.transactionId === unknown.transactionId)
          ?.category
      }. Valid categories: ${categories.map((row) => row.name).join(", ")}.`,
    };
  }

  const canonical = resolved as TransactionCategoryAssignment[];
  return await db.begin(async (tx) => {
    const transactions = await tx`
      SELECT t.id,
        EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id) AS split
      FROM transactions t
      WHERE t.id = ANY(${transactionIds})
        AND t.transaction_type = 'expense'
        AND NOT t.pending
        AND t.removed_at IS NULL
      FOR UPDATE
    ` as unknown as { id: string; split: boolean }[];
    if (transactions.length !== canonical.length) {
      return {
        ok: false,
        problem: "One or more transaction IDs are not active posted expenses.",
      };
    }
    if (transactions.some((transaction) => transaction.split)) {
      return {
        ok: false,
        problem:
          "One or more transactions already have a split. Use split_transaction to replace it.",
      };
    }

    for (const assignment of canonical) {
      await tx`
        UPDATE transactions SET category = ${assignment.category},
          category_source = 'manual', needs_category = false, updated_at = now()
        WHERE id = ${assignment.transactionId}
      `;
    }
    const closed = await tx`
      UPDATE categorization_batch_items SET answered_at = now()
      WHERE transaction_id = ANY(${transactionIds}) AND answered_at IS NULL
      RETURNING id
    `;
    if (closed.length > 0) {
      await tx`
        UPDATE categorization_batches b SET completed_at = now()
        WHERE b.completed_at IS NULL AND NOT EXISTS (
          SELECT 1 FROM categorization_batch_items i
          WHERE i.batch_id = b.id AND i.answered_at IS NULL
        )
      `;
    }

    return {
      ok: true,
      assignments: canonical,
      queueItemsClosed: closed.length,
    };
  });
}
