import { db } from "@/db.ts";

export interface CategoryAnswer {
  transactionId: string;
  merchantName: string | null;
  category: string;
}

// A tap is a per-transaction decision, so it is stored as 'manual' — stronger than a rule, and
// deliberately immune to a later rule replay overwriting it.
export async function applyCategoryAnswer(
  promptId: number,
  categoryId: number,
): Promise<CategoryAnswer | null> {
  const rows = await db`
    WITH chosen AS (
      SELECT p.transaction_id, c.name AS category
      FROM categorization_prompts p
      JOIN categories c ON c.id = ${categoryId}
      WHERE p.id = ${promptId}
    ), applied AS (
      UPDATE transactions t
      SET category = chosen.category,
          category_source = 'manual',
          needs_category = false,
          updated_at = now()
      FROM chosen WHERE t.id = chosen.transaction_id
      RETURNING t.id, t.merchant_name, chosen.category
    ), marked AS (
      UPDATE categorization_prompts SET answered_at = now()
      WHERE id = ${promptId} AND EXISTS (SELECT 1 FROM applied)
      RETURNING id
    )
    SELECT id, merchant_name, category FROM applied
  ` as unknown as { id: string; merchant_name: string | null; category: string }[];

  if (rows.length === 0) return null;

  return {
    transactionId: rows[0].id,
    merchantName: rows[0].merchant_name,
    category: rows[0].category,
  };
}
