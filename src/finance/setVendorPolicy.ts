import { db } from "@/db.ts";
import { applyCategoryRule } from "@/finance/applyCategoryRule.ts";

export interface SetVendorPolicyArgs {
  matchType: "merchant" | "description_contains";
  matchValue: string;
  policy: "auto" | "ask";
  category?: string;
}

export interface SetVendorPolicyResult {
  updated: number;
  refusedAsTooBroad?: number;
}

// An 'auto' policy is a category rule, so it reuses applyCategoryRule and inherits its guards:
// escaped LIKE wildcards, the 500-row ceiling, manual answers left alone, split charges skipped.
// An 'ask' policy has no category to apply, so it only records the rule and clears any stale
// default the vendor previously had.
export async function setVendorPolicy(
  args: SetVendorPolicyArgs,
): Promise<SetVendorPolicyResult> {
  if (args.policy === "auto") {
    if (!args.category) throw new Error("An auto policy needs a category");
    const result = await applyCategoryRule({
      matchType: args.matchType,
      matchValue: args.matchValue,
      category: args.category,
    });
    if (result.refusedAsTooBroad) return result;

    await db`
      UPDATE category_rules SET policy = 'auto'
      WHERE match_type = ${args.matchType} AND match_value = ${args.matchValue}
    `;
    return result;
  }

  await db`
    INSERT INTO category_rules (match_type, match_value, category, policy)
    VALUES (${args.matchType}, ${args.matchValue}, NULL, 'ask')
    ON CONFLICT (match_type, match_value)
      DO UPDATE SET policy = 'ask', category = NULL, created_at = now()
  `;

  return { updated: 0 };
}
