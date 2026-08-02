export interface CategoryUsage {
  name: string;
  count: number;
}

export interface SuggestCategoriesArgs {
  forThisMerchant: CategoryUsage[];
  overall: CategoryUsage[];
  slots: number;
}

// What this merchant has been given before, most frequent first, then the user's most-used
// categories to fill the row. Both lists arrive already ordered by the database; this only merges
// them and removes duplicates, so it stays pure and testable.
//
// The merchant list leads because a repeat visit to a known place is the common case, and getting
// it into the first row is what makes this a one-tap interaction rather than a search.
export function suggestCategories(args: SuggestCategoriesArgs): string[] {
  const seen = new Set<string>();
  const suggestions: string[] = [];

  for (const usage of [...args.forThisMerchant, ...args.overall]) {
    if (suggestions.length >= args.slots) break;
    if (seen.has(usage.name)) continue;
    seen.add(usage.name);
    suggestions.push(usage.name);
  }

  return suggestions;
}
