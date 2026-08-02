import * as v from "valibot";

// Three characters minimum for a substring rule. Two is enough to be catastrophic — "an" matches
// 467 of the transactions here — and applyCategoryRule's row ceiling is the real guard, but a
// length floor stops the most obvious mistakes before a count is even run.
const MIN_SUBSTRING_LENGTH = 3;

export const setCategoryRuleInputSchema = v.object({
  match_type: v.picklist(["merchant", "description_contains"]),
  match_value: v.pipe(v.string(), v.minLength(MIN_SUBSTRING_LENGTH)),
  category: v.pipe(v.string(), v.minLength(2)),
});
