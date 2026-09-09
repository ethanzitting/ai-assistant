import { db } from "@/db.ts";

export interface CreateFinanceCategoryResult {
  changed: boolean;
  reason?: "category_exists";
  categoryId?: number;
  categoryName?: string;
}

export async function createFinanceCategory(
  requestedName: string,
): Promise<CreateFinanceCategoryResult> {
  const categoryName = requestedName.trim().replaceAll(/\s+/g, " ");
  const existing = await db`
    SELECT id, name FROM categories
    WHERE lower(name) = lower(${categoryName})
    LIMIT 1
  ` as unknown as { id: number; name: string }[];
  if (existing.length > 0) {
    return {
      changed: false,
      reason: "category_exists",
      categoryId: existing[0].id,
      categoryName: existing[0].name,
    };
  }

  const [category] = await db`
    INSERT INTO categories (name, sort_order)
    VALUES (
      ${categoryName},
      (SELECT coalesce(max(sort_order), 0) + 1 FROM categories WHERE active)
    )
    RETURNING id, name
  ` as unknown as { id: number; name: string }[];
  return {
    changed: true,
    categoryId: category.id,
    categoryName: category.name,
  };
}
