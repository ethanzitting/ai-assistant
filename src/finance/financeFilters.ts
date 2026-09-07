import type { DateRange } from "@/finance/resolveDateRange.ts";

// Null means "no filter". Every query interpolates these the same way:
//
//   AND (${filters.categories}::text[] IS NULL OR lower(category) = ANY(${filters.categories}))
//
// A null array makes the guard true and the comparison short-circuits, which keeps one SQL shape
// for every combination of filters instead of composing fragments.
export interface FinanceFilters {
  range: DateRange;
  categories: string[] | null;
  merchants: string[] | null;
  accounts: string[] | null;
}

export interface FinanceFilterInput {
  categories?: string[];
  merchants?: string[];
  accounts?: string[];
}

// Matching is case-insensitive because these values reach us from the model paraphrasing the user,
// not from a picker. "Groceries" and "groceries" must be the same filter.
export function financeFilters(range: DateRange, input: FinanceFilterInput): FinanceFilters {
  return {
    range,
    categories: lowercased(input.categories),
    merchants: lowercased(input.merchants),
    accounts: lowercased(input.accounts),
  };
}

function lowercased(values?: string[]): string[] | null {
  if (!values || values.length === 0) return null;
  return values.map((value) => value.toLowerCase());
}
