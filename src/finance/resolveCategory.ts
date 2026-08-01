export type CategorySource = "rule" | "plaid";

export interface CategoryRule {
  match_type: string;
  match_value: string;
  category: string;
}

export interface ResolveCategoryArgs {
  merchantName: string | null;
  description: string;
  plaidCategoryPrimary: string | null;
  rules: CategoryRule[];
}

export interface ResolvedCategory {
  category: string | null;
  source: CategorySource | null;
}

export function resolveCategory(args: ResolveCategoryArgs): ResolvedCategory {
  const matched = args.rules.find((rule) => matches(rule, args));
  if (matched) return { category: matched.category, source: "rule" };

  if (args.plaidCategoryPrimary) {
    return { category: humanize(args.plaidCategoryPrimary), source: "plaid" };
  }

  return { category: null, source: null };
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

// Plaid's taxonomy is SCREAMING_SNAKE. "FOOD_AND_DRINK" reads badly in a spending summary and
// badly in a prompt, so it becomes "food and drink" before it is stored.
function humanize(plaidCategory: string): string {
  return plaidCategory.toLowerCase().replaceAll("_", " ");
}
