import * as v from "valibot";

const isoDate = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"));

export const QUERY_TYPES = [
  "spending_summary",
  "spending_by_category",
  "spending_by_merchant",
  "account_balances",
  "transaction_search",
  "trends",
] as const;

export const queryFinancesInputSchema = v.object({
  query_type: v.picklist(QUERY_TYPES),
  start_date: v.optional(isoDate),
  end_date: v.optional(isoDate),
  categories: v.optional(v.array(v.string())),
  merchants: v.optional(v.array(v.string())),
  accounts: v.optional(v.array(v.string())),
  search: v.optional(v.string()),
  compare_to: v.optional(v.picklist(["previous_period", "same_period_last_year"])),
  limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100))),
});

export const setCategoryRuleInputSchema = v.object({
  match_type: v.picklist(["merchant", "description_contains"]),
  match_value: v.pipe(v.string(), v.minLength(2)),
  category: v.pipe(v.string(), v.minLength(2)),
});
