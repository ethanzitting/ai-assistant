import { UNSORTED_CATEGORY } from "@/finance/unsortedCategory.ts";

export type CategorySource = "rule" | "manual";
export type RulePolicy = "auto" | "ask";

export interface CategoryRule {
  match_type: string;
  match_value: string;
  category: string | null;
  policy: RulePolicy;
}

export interface ResolveCategoryArgs {
  merchantName: string | null;
  description: string;
  rules: CategoryRule[];
}

export interface ResolvedCategory {
  category: string;
  source: CategorySource | null;
  needsCategory: boolean;
}

// Plaid's category no longer feeds this at all. It was wrong consistently rather than erratically —
// Walmart is GENERAL_MERCHANDISE on all 234 transactions — so inheriting it produced confident
// wrong answers. A transaction is now either matched by a rule the user created, or it is Unsorted
// and gets asked about.
export function resolveCategory(args: ResolveCategoryArgs): ResolvedCategory {
  const matched = args.rules.find((rule) => matches(rule, args));

  if (matched?.policy === "auto" && matched.category) {
    return { category: matched.category, source: "rule", needsCategory: false };
  }

  // Either an explicit 'ask' rule, or no rule at all. Both mean the same thing downstream.
  return { category: UNSORTED_CATEGORY, source: null, needsCategory: true };
}

function matches(rule: CategoryRule, args: ResolveCategoryArgs): boolean {
  const value = rule.match_value.toLowerCase();

  if (rule.match_type === "merchant") {
    return args.merchantName?.toLowerCase() === value;
  }
  if (rule.match_type === "description_contains") {
    return args.description.toLowerCase().includes(value);
  }

  return false;
}
