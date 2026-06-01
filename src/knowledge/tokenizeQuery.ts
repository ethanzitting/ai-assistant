// Split a search query into lowercased alphanumeric tokens for keyword (ILIKE) matching.
// Splits on any run of non-alphanumeric characters so punctuation and possessives don't
// fuse words: "Dana's medications" → ["dana", "s", "medications"] → ["dana",
// "medications"] (1-char tokens dropped as noise), and "dana" matches "Dana Whitfield".
export function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2);
}
