import { db } from "@/db.ts";

export interface ActiveCategoryResolution {
  category: string | null;
  validCategories: string[];
}

export async function resolveActiveCategory(
  requestedCategory: string,
): Promise<ActiveCategoryResolution> {
  const rows = await db`
    SELECT name FROM categories WHERE active ORDER BY sort_order
  ` as unknown as { name: string }[];
  const category =
    rows.find((row) =>
      row.name.toLowerCase() === requestedCategory.toLowerCase()
    )?.name ?? null;
  return { category, validCategories: rows.map((row) => row.name) };
}
