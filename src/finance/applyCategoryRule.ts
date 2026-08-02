import { db } from "@/db.ts";

export interface ApplyCategoryRuleArgs {
  matchType: "merchant" | "description_contains";
  matchValue: string;
  category: string;
}

// The rule is stored AND replayed over history in one go. A correction that only affected future
// transactions would leave every past total wrong while looking like it worked, which teaches the
// user not to trust the numbers. Rows the user corrected by hand are left alone — a rule is a
// weaker signal than an explicit per-transaction decision.
export async function applyCategoryRule(args: ApplyCategoryRuleArgs): Promise<number> {
  await db`
    INSERT INTO category_rules (match_type, match_value, category)
    VALUES (${args.matchType}, ${args.matchValue}, ${args.category})
    ON CONFLICT (match_type, match_value)
      DO UPDATE SET category = EXCLUDED.category, created_at = now()
  `;

  const matchesMerchant = args.matchType === "merchant";
  const pattern = `%${args.matchValue}%`;

  const updated = await db`
    UPDATE transactions SET
      category = ${args.category},
      category_source = 'rule',
      updated_at = now()
    WHERE removed_at IS NULL
      AND category_source IS DISTINCT FROM 'manual'
      AND category IS DISTINCT FROM ${args.category}
      AND CASE WHEN ${matchesMerchant}
               THEN lower(merchant_name) = lower(${args.matchValue})
               ELSE description ILIKE ${pattern}
          END
    RETURNING id
  `;

  return updated.length;
}
