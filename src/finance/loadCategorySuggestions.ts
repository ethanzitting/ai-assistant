import { db } from "@/db.ts";
import { suggestCategories, type CategoryUsage } from "@/finance/suggestCategories.ts";
import { UNSORTED_CATEGORY } from "@/finance/unsortedCategory.ts";

const SUGGESTION_SLOTS = 6;

export async function loadCategorySuggestions(merchantName: string | null): Promise<string[]> {
  const [forThisMerchant, overall] = await Promise.all([
    merchantName ? usageForMerchant(merchantName) : Promise.resolve([]),
    overallUsage(),
  ]);

  return suggestCategories({ forThisMerchant, overall, slots: SUGGESTION_SLOTS });
}

// Reads the view, not the table, so a category the user only ever reached through a split still
// counts as something they use for this merchant.
async function usageForMerchant(merchantName: string): Promise<CategoryUsage[]> {
  return await db`
    SELECT category AS name, count(*)::int AS count
    FROM transaction_categories
    WHERE removed_at IS NULL
      AND lower(merchant_name) = lower(${merchantName})
      AND category <> ${UNSORTED_CATEGORY}
    GROUP BY 1 ORDER BY 2 DESC
  ` as unknown as CategoryUsage[];
}

async function overallUsage(): Promise<CategoryUsage[]> {
  return await db`
    SELECT c.name, count(tc.id)::int AS count
    FROM categories c
    LEFT JOIN transaction_categories tc
      ON tc.category = c.name AND tc.removed_at IS NULL
    WHERE c.active
    GROUP BY c.name, c.sort_order
    ORDER BY 2 DESC, c.sort_order
  ` as unknown as CategoryUsage[];
}
